/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HTML Applet Versioning System
 * 
 * Handles version management for user-created HTML applets:
 * - Detects similar existing apps
 * - Generates appropriate version numbers (v1, v2, v1.1, etc.)
 * - Manages user preferences for versioning vs modification
 * - Provides version-aware search ranking
 */

import { getLogger } from '@interface/lib/logger';

import { EnhancedHtmlContent } from '../types/html-generation-types';

import { generateOpId } from './diagnostics';

const log = getLogger('[html-generation.versioning-system]');

export interface VersioningResult {
  shouldCreateNewVersion: boolean;
  suggestedName?: string;
  similarApps: SimilarApp[];
  versionStrategy: 'major' | 'minor' | 'modify_existing';
  userPrompt?: string;
  metadata: {
    baseAppDetected?: string;
    versionNumber?: string;
    totalVersions: number;
    latestVersion?: string;
    changeType?: 'minor' | 'major';
    nextMinorVersion?: string;
    nextMajorVersion?: string;
    recommendedChoice?: 'original' | 'new_version';
  };
}

export interface SimilarApp {
  applet: EnhancedHtmlContent;
  similarity: number;
  baseNameMatch: boolean;
  versionInfo?: {
    baseName: string;
    version: string;
    versionNumber: number;
    isLatest: boolean;
  };
}

export interface VersioningOptions {
  userPreference?: 'new_version' | 'modify_existing' | 'ask_user';
  similarityThreshold?: number;
  autoVersioning?: boolean;
  maxVersionsToConsider?: number;
}

/**
 * Analyzes modification request and determines the appropriate versioning strategy
 * Based on the new specification:
 * - Initial generations start directly with v1
 * - Minor updates increment decimal (v1 -> v1.1)
 * - Major updates increment whole number (v1 -> v2)
 * - Always ask user for confirmation and save choice
 */
export function analyzeVersioningStrategy(
  currentApplet: EnhancedHtmlContent,
  modificationRequest: string,
  userApplets: EnhancedHtmlContent[],
  options: VersioningOptions = {}
): VersioningResult {
  const {
    userPreference,
    similarityThreshold = 0.7,
    maxVersionsToConsider = 20
  } = options;

  log.info('analyzeVersioningStrategy: starting analysis', {
    currentAppletTitle: currentApplet.title,
    modificationPreview: modificationRequest.substring(0, 100),
    userPreference,
    totalUserApplets: userApplets.length
  });

  // Find similar apps based on name and content
  const similarApps = findSimilarApps(
    currentApplet,
    userApplets,
    similarityThreshold,
    maxVersionsToConsider
  );

  log.info('analyzeVersioningStrategy: similar apps found', {
    similarAppsCount: similarApps.length,
    topMatches: similarApps.slice(0, 3).map(s => ({
      title: s.applet.title,
      similarity: s.similarity,
      baseNameMatch: s.baseNameMatch
    }))
  });

  // Extract base name and version info
  const currentVersionInfo = extractBaseNameAndVersion(currentApplet.title);
  
  // Get latest version of this app series
  const latestVersion = getLatestVersion(similarApps, currentVersionInfo.baseName);
  
  log.info('analyzeVersioningStrategy: version analysis', {
    currentVersionInfo,
    latestVersion: latestVersion?.versionInfo
  });

  // If user explicitly specified preference, respect it
  if (userPreference === 'modify_existing') {
    // Even when modifying existing, we calculate the next minor version
    // so the title can be updated (e.g. "App v1" -> "App v1.1")
    const nextMinorVersion = generateNextVersion(currentVersionInfo, similarApps, 'minor');

    return {
      shouldCreateNewVersion: false,
      similarApps,
      versionStrategy: 'modify_existing',
      metadata: {
        baseAppDetected: currentVersionInfo.baseName,
        versionNumber: currentVersionInfo.version,
        totalVersions: similarApps.length,
        latestVersion: latestVersion?.applet.title,
        nextMinorVersion
      }
    };
  }

  if (userPreference === 'new_version') {
    const nextVersion = generateNextVersion(currentVersionInfo, similarApps, 'major');
    return {
      shouldCreateNewVersion: true,
      suggestedName: `${currentVersionInfo.baseName} ${nextVersion}`,
      similarApps,
      versionStrategy: 'major',
      metadata: {
        baseAppDetected: currentVersionInfo.baseName,
        versionNumber: nextVersion,
        totalVersions: similarApps.length + 1,
        latestVersion: latestVersion?.applet.title
      }
    };
  }

  // Determine if this is a minor or major modification
  const isMinorChange = isMinorModification(modificationRequest);
  const changeType = isMinorChange ? 'minor' : 'major';

  log.info('analyzeVersioningStrategy: change analysis', {
    changeType,
    isMinorChange,
    modificationPreview: modificationRequest.substring(0, 50)
  });

  // Generate version options for user choice
  const nextMinorVersion = generateNextVersion(currentVersionInfo, similarApps, 'minor');
  const nextMajorVersion = generateNextVersion(currentVersionInfo, similarApps, 'major');

  // Always return with user prompt for save choice - no automatic decisions
  return {
    shouldCreateNewVersion: false, // Will be determined by user choice
    suggestedName: changeType === 'minor' 
      ? `${currentVersionInfo.baseName} ${nextMinorVersion}` 
      : `${currentVersionInfo.baseName} ${nextMajorVersion}`,
    similarApps,
    versionStrategy: changeType,
    userPrompt: `
**Modification Complete!** 

I've updated the **${currentApplet.title}** applet with your requested changes.

**Change Type Detected:** ${changeType === 'minor' ? 'Minor Update' : 'Major Update'}

**How would you like to save these changes?**

**Option A - Save to Original (${changeType === 'minor' ? 'Recommended for minor changes' : 'Update existing'}):**
- Updates: **${currentApplet.title}** → **${currentVersionInfo.baseName} ${nextMinorVersion}**
- Modifies the existing applet

**Option B - Create New Version (${changeType === 'major' ? 'Recommended for major changes' : 'Keep original intact'}):**
- Creates: **${currentVersionInfo.baseName} ${nextMajorVersion}**
- Keeps the original applet unchanged

Please let me know your choice:
- Use \`saveChoice: "original"\` to save to original (Option A)
- Use \`saveChoice: "new_version"\` to create new version (Option B)
    `.trim(),
    metadata: {
      baseAppDetected: currentVersionInfo.baseName,
      versionNumber: currentVersionInfo.version,
      totalVersions: similarApps.length,
      changeType,
      nextMinorVersion,
      nextMajorVersion,
      recommendedChoice: changeType === 'minor' ? 'original' : 'new_version'
    }
  };
}

/**
 * Creates version metadata for new applets
 * New specification: Initial generations start directly with v1
 */
export function createVersionMetadata(
  appletName: string,
  userApplets: EnhancedHtmlContent[],
  versionStrategy: 'major' | 'minor' = 'major',
  isInitialGeneration: boolean = true
): { finalName: string; versionInfo: any } {
  const metadataOperationId = `vm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  log.info('createVersionMetadata: start', {
    metadataOperationId,
    step: 'METADATA_START',
    input: {
      appletName,
      isInitialGeneration,
      versionStrategy,
      userAppletsCount: userApplets.length
    }
  });

  const versionInfo = extractBaseNameAndVersion(appletName);
  log.info('createVersionMetadata: extracted version info', {
    metadataOperationId,
    step: 'VERSION_EXTRACTION',
    input: {
      originalAppletName: appletName
    },
    output: {
      baseName: versionInfo.baseName,
      version: versionInfo.version,
      hasVersion: versionInfo.hasVersion
    },
    analysis: {
      nameContainsVersion: versionInfo.hasVersion,
      baseNameLength: versionInfo.baseName.length,
      versionPattern: versionInfo.version || 'none'
    }
  });

  const similarApps = findSimilarApps(
    { title: appletName } as EnhancedHtmlContent,
    userApplets,
    0.8,
    20
  );

  if (isInitialGeneration) {
    // Initial generation - start directly with v1 (no approval needed)
    const finalName = `${versionInfo.baseName} v1`;
    log.info('createVersionMetadata: creating initial v1 applet', {
      metadataOperationId,
      step: 'INITIAL_V1_CREATION',
      condition: 'isInitialGeneration = true',
      input: {
        originalName: appletName,
        baseName: versionInfo.baseName,
        hadVersionAlready: versionInfo.hasVersion,
        similarAppsFound: similarApps.length
      },
      output: {
        finalName: finalName,
        version: 'v1',
        isInitialGeneration: true,
        isFirstVersion: true
      },
      verification: {
        nameTransformation: `"${appletName}" → "${finalName}"`,
        versionAppended: finalName.endsWith(' v1'),
        expectedFormat: `${versionInfo.baseName} v1`,
        matchesExpected: finalName === `${versionInfo.baseName} v1`
      }
    });
    
    return {
      finalName,
      versionInfo: {
        baseName: versionInfo.baseName,
        version: 'v1',
        isInitialGeneration: true,
        isFirstVersion: true
      }
    };
  }

  if (similarApps.length === 0) {
    // No similar apps, start with v1
    return {
      finalName: `${versionInfo.baseName} v1`,
      versionInfo: {
        baseName: versionInfo.baseName,
        version: 'v1',
        isFirstVersion: true
      }
    };
  }

  // Generate next version for existing app series
  const nextVersion = generateNextVersion(versionInfo, similarApps, versionStrategy);
  const finalName = `${versionInfo.baseName} ${nextVersion}`;

  return {
    finalName,
    versionInfo: {
      baseName: versionInfo.baseName,
      version: nextVersion,
      isFirstVersion: false,
      totalVersions: similarApps.length + 1
    }
  };
}

/**
 * Applies version-aware ranking to search results
 */
export function applyVersionRanking(
  searchResults: any[],
  options: { prioritizeLatest?: boolean } = {}
): any[] {
  const { prioritizeLatest = true } = options;

  if (!prioritizeLatest) {
    return searchResults;
  }

  log.info('applyVersionRanking: applying version-aware ranking', {
    originalResultsCount: searchResults.length
  });

  // Group results by base name
  const groupedByBaseName = new Map<string, any[]>();
  
  searchResults.forEach(result => {
    const versionInfo = extractBaseNameAndVersion(result.applet.title);
    const baseName = versionInfo.baseName;
    
    if (!groupedByBaseName.has(baseName)) {
      groupedByBaseName.set(baseName, []);
    }
    
    groupedByBaseName.get(baseName)!.push({
      ...result,
      versionInfo
    });
  });

  // For each group, boost the latest version
  const rankedResults: any[] = [];
  
  groupedByBaseName.forEach((group, baseName) => {
    if (group.length === 1) {
      // Single version, keep as-is
      rankedResults.push(group[0]);
      return;
    }

    // Sort by version number (latest first)
    group.sort((a, b) => {
      const aVersion = parseVersionNumber(a.versionInfo.version);
      const bVersion = parseVersionNumber(b.versionInfo.version);
      return bVersion - aVersion;
    });

    // Boost the latest version's relevance score
    const latestVersion = group[0];
    latestVersion.relevanceScore = Math.min(1.0, latestVersion.relevanceScore * 1.2);
    latestVersion.matchReasons = [
      'Latest version',
      ...latestVersion.matchReasons
    ];

    // Add all versions but with latest first
    rankedResults.push(...group);
  });

  // Re-sort by updated relevance scores
  rankedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

  log.info('applyVersionRanking: ranking applied', {
    rankedResultsCount: rankedResults.length,
    topResults: rankedResults.slice(0, 5).map(r => ({
      title: r.applet.title,
      score: r.relevanceScore,
      isLatest: r.matchReasons.includes('Latest version')
    }))
  });

  return rankedResults;
}

/**
 * Comprehensive logging utility for versioning operations
 */
export function logVersioningOperation(
  operationType: 'CREATE' | 'MODIFY' | 'SEARCH' | 'ANALYZE',
  operationId: string,
  step: string,
  data: any
) {
  const logEntry = {
    operationType,
    operationId,
    step,
    timestamp: new Date().toISOString(),
    ...data
  };

  log.info(`VERSIONING_${operationType}: ${step}`, logEntry);

  // Store in sessionStorage for debugging (if available)
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const logs = JSON.parse(sessionStorage.getItem('versioningLogs') || '[]');
      logs.push(logEntry);
      // Keep only last 100 logs
      if (logs.length > 100) logs.shift();
      sessionStorage.setItem('versioningLogs', JSON.stringify(logs));
    } catch (e) {
      // Ignore storage errors
    }
  }
}

/**
 * Extracts base name and version from app title
 */
export function extractBaseNameAndVersion(title: string): {
  baseName: string;
  version: string;
  hasVersion: boolean;
} {
  // Match patterns like "App Name v1.2", "App Name v2", "App Name version 1"
  const versionPatterns = [
    /^(.+?)\s+v(\d+(?:\.\d+)*)$/i,
    /^(.+?)\s+version\s+(\d+(?:\.\d+)*)$/i,
    /^(.+?)\s+ver\s+(\d+(?:\.\d+)*)$/i,
    /^(.+?)\s+\(v(\d+(?:\.\d+)*)\)$/i
  ];

  for (const pattern of versionPatterns) {
    const match = title.match(pattern);
    if (match) {
      return {
        baseName: match[1].trim(),
        version: `v${match[2]}`,
        hasVersion: true
      };
    }
  }

  // No version found, treat entire title as base name
  return {
    baseName: title.trim(),
    version: '',
    hasVersion: false
  };
}

/**
 * Generates the next version number
 */
export function generateNextVersion(
  currentVersionInfo: ReturnType<typeof extractBaseNameAndVersion>,
  similarApps: SimilarApp[],
  strategy: 'major' | 'minor'
): string {
  const currentVersion = currentVersionInfo.version || 'v1';
  
  log.info('generateNextVersion: processing version increment', {
    currentVersion,
    strategy,
    baseName: currentVersionInfo.baseName
  });

  if (strategy === 'minor') {
    // Minor update: increment decimal (v1 -> v1.1, v1.1 -> v1.2, v2 -> v2.1)
    const versionMatch = currentVersion.match(/^v(\d+)(?:\.(\d+))?$/);
    if (versionMatch) {
      const major = parseInt(versionMatch[1]);
      const minor = parseInt(versionMatch[2] || '0');
      const newVersion = `v${major}.${minor + 1}`;
      
      log.info('generateNextVersion: minor increment', {
        from: currentVersion,
        to: newVersion
      });
      
      return newVersion;
    }
  } else {
    // Major update: increment whole number (v1 -> v2, v1.5 -> v2, v2.3 -> v3)
    const versionMatch = currentVersion.match(/^v(\d+)/);
    if (versionMatch) {
      const major = parseInt(versionMatch[1]);
      const newVersion = `v${major + 1}`;
      
      log.info('generateNextVersion: major increment', {
        from: currentVersion,
        to: newVersion
      });
      
      return newVersion;
    }
  }

  // Fallback: if version parsing fails, default to v2
  log.warn('generateNextVersion: fallback to v2 due to parsing failure');
  return 'v2';
}

/**
 * Helper function to parse version number for comparison
 */
function parseVersionNumber(version: string): number {
  const versionStr = version.replace(/^v/i, '');
  const parts = versionStr.split('.');
  const major = parseInt(parts[0]) || 0;
  const minor = parseInt(parts[1]) || 0;
  return major + (minor / 100); // e.g., v1.5 becomes 1.05
}

/**
 * Helper function to increment version
 */
function incrementVersion(version: string, type: 'major' | 'minor'): string {
  const versionNum = parseVersionNumber(version);
  const major = Math.floor(versionNum);
  const minor = Math.round((versionNum % 1) * 100);

  if (type === 'major') {
    return `v${major + 1}`;
  } else {
    return `v${major}.${minor + 1}`;
  }
}

/**
 * Checks for version conflicts when creating new applets
 */
export function checkVersionConflicts(
  proposedName: string,
  userApplets: EnhancedHtmlContent[]
): {
  hasConflicts: boolean;
  existingVersions: Array<{
    title: string;
    version: string;
    id: string;
    createdAt: string;
  }>;
  baseName: string;
  suggestedVersionName: string;
  userPrompt?: string;
} {
  const operationId = generateOpId();
  log.info('checkVersionConflicts: start', {
    operationId,
    step: 'CONFLICT_CHECK_START',
    input: {
      proposedName,
      totalUserApplets: userApplets.length
    }
  });

  // Extract base name from proposed name (remove version if present)
  const versionInfo = extractBaseNameAndVersion(proposedName);
  const baseName = versionInfo.baseName;

  log.info('checkVersionConflicts: extracted base name', {
    operationId,
    step: 'BASE_NAME_EXTRACTION',
    input: { proposedName },
    output: { 
      baseName,
      hasVersion: versionInfo.hasVersion,
      version: versionInfo.version
    }
  });

  // Find all existing versions of this base name
  const existingVersions = userApplets
    .map(applet => {
      const appletVersionInfo = extractBaseNameAndVersion(applet.title);
      return {
        applet,
        versionInfo: appletVersionInfo,
        similarity: calculateSimilarity(baseName.toLowerCase(), appletVersionInfo.baseName.toLowerCase())
      };
    })
    .filter(item => item.similarity > 0.85) // High similarity threshold for version conflicts
    .map(item => ({
      title: item.applet.title,
      version: item.versionInfo.version || 'v1',
      id: (item.applet as any)._id || (item.applet as any).id || 'unknown',
      createdAt: item.applet.createdAt || new Date().toISOString()
    }))
    .sort((a, b) => {
      // Sort by version number (latest first)
      const aVersion = parseVersionNumber(a.version);
      const bVersion = parseVersionNumber(b.version);
      return bVersion - aVersion;
    });

  log.info('checkVersionConflicts: found existing versions', {
    operationId,
    step: 'EXISTING_VERSIONS_FOUND',
    analysis: {
      baseName,
      existingVersionsCount: existingVersions.length,
      existingVersions: existingVersions.map(v => ({ title: v.title, version: v.version }))
    }
  });

  const hasConflicts = existingVersions.length > 0;

  if (hasConflicts) {
    // Determine next version number
    const similarApps = userApplets.filter(a => 
      extractBaseNameAndVersion(a.title).baseName.toLowerCase() === baseName.toLowerCase()
    );
    
    // Find the highest version number
    const highestVersionNumber = Math.max(
      ...existingVersions.map(v => parseVersionNumber(v.version))
    );
    const nextVersionNumber = `v${highestVersionNumber + 1}`;
    
    const suggestedVersionName = `${baseName} ${nextVersionNumber}`;

    // Create user prompt for version conflict resolution
    const versionsList = existingVersions
      .map(v => `• ${v.title} (created ${new Date(v.createdAt).toLocaleDateString()})`)
      .join('\n');

    const userPrompt = `I found existing versions of "${baseName}":\n\n${versionsList}\n\nWould you like to:\n1. Create a new version: "${suggestedVersionName}"\n2. Open an existing version\n3. Choose a different name\n\nPlease let me know your preference.`;

    log.warn('checkVersionConflicts: version conflict detected', {
      operationId,
      step: 'CONFLICT_RESOLUTION_NEEDED',
      decision: 'USER_PROMPT_REQUIRED',
      output: {
        hasConflicts: true,
        existingVersionsCount: existingVersions.length,
        suggestedVersionName,
        userPromptGenerated: true
      }
    });

    return {
      hasConflicts: true,
      existingVersions,
      baseName,
      suggestedVersionName,
      userPrompt
    };
  }

  // No conflicts - suggest v1 for new app
  const suggestedVersionName = `${baseName} v1`;

  log.info('checkVersionConflicts: no conflicts found', {
    operationId,
    step: 'NO_CONFLICTS',
    output: {
      hasConflicts: false,
      suggestedVersionName,
      isFirstVersion: true
    }
  });

  return {
    hasConflicts: false,
    existingVersions: [],
    baseName,
    suggestedVersionName
  };
}

/**
 * Performs smart search with version awareness
 */
export function performSmartSearch(
  query: string,
  userApplets: EnhancedHtmlContent[]
): {
  hasMultipleVersions: boolean;
  versions: Array<{
    title: string;
    version: string;
    id: string;
    createdAt: string;
    isLatest: boolean;
  }>;
  baseName: string;
  suggestedAction: 'open_latest' | 'show_versions' | 'no_matches';
  userPrompt?: string;
} {
  const operationId = generateOpId();
  log.info('performSmartSearch: start', {
    operationId,
    step: 'SMART_SEARCH_START',
    input: {
      query,
      totalUserApplets: userApplets.length
    }
  });

  // Extract base name from query
  const queryVersionInfo = extractBaseNameAndVersion(query);
  const baseName = queryVersionInfo.baseName.toLowerCase();

  // Find all matching versions
  const matchingVersions = userApplets
    .map(applet => {
      const appletVersionInfo = extractBaseNameAndVersion(applet.title);
      return {
        applet,
        versionInfo: appletVersionInfo,
        similarity: calculateSimilarity(baseName, appletVersionInfo.baseName.toLowerCase())
      };
    })
    .filter(item => item.similarity > 0.7) // Good similarity threshold
    .map(item => ({
      title: item.applet.title,
      version: item.versionInfo.version || 'v1',
      id: (item.applet as any)._id || (item.applet as any).id || 'unknown',
      createdAt: item.applet.createdAt || new Date().toISOString(),
      versionNumber: parseVersionNumber(item.versionInfo.version || 'v1'),
      similarity: item.similarity
    }))
    .sort((a, b) => {
      // Sort by version number (latest first)
      return b.versionNumber - a.versionNumber;
    });

  log.info('performSmartSearch: found matching versions', {
    operationId,
    step: 'MATCHING_VERSIONS_FOUND',
    analysis: {
      query,
      baseName,
      matchingVersionsCount: matchingVersions.length,
      matchingVersions: matchingVersions.map(v => ({ 
        title: v.title, 
        version: v.version, 
        similarity: v.similarity.toFixed(2)
      }))
    }
  });

  if (matchingVersions.length === 0) {
    log.info('performSmartSearch: no matches found', {
      operationId,
      step: 'NO_MATCHES',
      decision: 'SUGGEST_CREATE_NEW'
    });

    return {
      hasMultipleVersions: false,
      versions: [],
      baseName: queryVersionInfo.baseName,
      suggestedAction: 'no_matches'
    };
  }

  if (matchingVersions.length === 1) {
    log.info('performSmartSearch: single version found', {
      operationId,
      step: 'SINGLE_VERSION',
      decision: 'OPEN_DIRECTLY',
      foundVersion: matchingVersions[0].title
    });

    return {
      hasMultipleVersions: false,
      versions: matchingVersions.map(v => ({
        title: v.title,
        version: v.version,
        id: v.id,
        createdAt: v.createdAt,
        isLatest: true
      })),
      baseName: queryVersionInfo.baseName,
      suggestedAction: 'open_latest'
    };
  }

  // Multiple versions found
  const latestVersion = matchingVersions[0];
  const versionsList = matchingVersions
    .map((v, index) => `${index + 1}. ${v.title} (created ${new Date(v.createdAt).toLocaleDateString()})`)
    .join('\n');

  const userPrompt = `I found ${matchingVersions.length} versions of "${queryVersionInfo.baseName}":\n\n${versionsList}\n\nWould you like to:\n1. Open the latest version: "${latestVersion.title}"\n2. Choose a specific version\n\nPlease let me know your preference.`;

  log.info('performSmartSearch: multiple versions found', {
    operationId,
    step: 'MULTIPLE_VERSIONS',
    decision: 'USER_CHOICE_REQUIRED',
    analysis: {
      totalVersions: matchingVersions.length,
      latestVersion: latestVersion.title,
      userPromptGenerated: true
    }
  });

  return {
    hasMultipleVersions: true,
    versions: matchingVersions.map((v, index) => ({
      title: v.title,
      version: v.version,
      id: v.id,
      createdAt: v.createdAt,
      isLatest: index === 0
    })),
    baseName: queryVersionInfo.baseName,
    suggestedAction: 'show_versions',
    userPrompt
  };
}

/**
 * Finds similar apps based on name and content similarity
 */
function findSimilarApps(
  currentApplet: EnhancedHtmlContent,
  userApplets: EnhancedHtmlContent[],
  similarityThreshold: number,
  maxResults: number
): SimilarApp[] {
  const currentVersionInfo = extractBaseNameAndVersion(currentApplet.title);
  const similarApps: SimilarApp[] = [];

  userApplets.forEach(applet => {
    if (applet._id === currentApplet._id) return; // Skip self

    const similarity = calculateSimilarity(currentApplet, applet);
    const appletVersionInfo = extractBaseNameAndVersion(applet.title);
    const baseNameMatch = appletVersionInfo.baseName.toLowerCase() === 
                         currentVersionInfo.baseName.toLowerCase();

    if (similarity >= similarityThreshold || baseNameMatch) {
      similarApps.push({
        applet,
        similarity,
        baseNameMatch,
        versionInfo: {
          baseName: appletVersionInfo.baseName,
          version: appletVersionInfo.version || 'v1',
          versionNumber: parseVersionNumber(appletVersionInfo.version || 'v1'),
          isLatest: false // Will be determined later
        }
      });
    }
  });

  // Sort by similarity and base name match priority
  similarApps.sort((a, b) => {
    if (a.baseNameMatch && !b.baseNameMatch) return -1;
    if (!a.baseNameMatch && b.baseNameMatch) return 1;
    return b.similarity - a.similarity;
  });

  // Mark latest version for each base name
  const baseNameGroups = new Map<string, SimilarApp[]>();
  similarApps.forEach(app => {
    const baseName = app.versionInfo!.baseName.toLowerCase();
    if (!baseNameGroups.has(baseName)) {
      baseNameGroups.set(baseName, []);
    }
    baseNameGroups.get(baseName)!.push(app);
  });

  baseNameGroups.forEach(group => {
    if (group.length > 0) {
      group.sort((a, b) => b.versionInfo!.versionNumber - a.versionInfo!.versionNumber);
      group[0].versionInfo!.isLatest = true;
    }
  });

  return similarApps.slice(0, maxResults);
}

/**
 * Calculates string similarity using Levenshtein distance
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
  if (len2 === 0) return 0.0;
  
  // Create a matrix for dynamic programming
  const matrix: number[][] = [];
  
  // Initialize the matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  // Calculate similarity as 1 - (distance / max_length)
  const maxLength = Math.max(len1, len2);
  const distance = matrix[len1][len2];
  return 1 - (distance / maxLength);
}

/**
 * Calculates similarity between two applets
 */
function calculateSimilarity(input1: string | EnhancedHtmlContent, input2: string | EnhancedHtmlContent): number {
  // Handle string-to-string comparison
  if (typeof input1 === 'string' && typeof input2 === 'string') {
    return calculateStringSimilarity(input1, input2);
  }
  
  // Handle applet-to-applet comparison
  const applet1 = input1 as EnhancedHtmlContent;
  const applet2 = input2 as EnhancedHtmlContent;
  const title1 = applet1.title.toLowerCase();
  const title2 = applet2.title.toLowerCase();
  
  // Extract base names for comparison
  const version1 = extractBaseNameAndVersion(applet1.title);
  const version2 = extractBaseNameAndVersion(applet2.title);
  
  // High similarity if same base name
  if (version1.baseName.toLowerCase() === version2.baseName.toLowerCase()) {
    return 0.95;
  }
  
  // Calculate title similarity using simple string matching
  const titleSimilarity = calculateStringSimilarity(title1, title2);
  
  // Factor in content type similarity
  const contentTypeSimilarity = applet1.contentType === applet2.contentType ? 0.2 : 0;
  
  // Factor in tag similarity
  const tags1 = applet1.tags || [];
  const tags2 = applet2.tags || [];
  const commonTags = tags1.filter(tag => tags2.includes(tag));
  const tagSimilarity = commonTags.length > 0 ? (commonTags.length / Math.max(tags1.length, tags2.length)) * 0.1 : 0;
  
  return Math.min(1.0, titleSimilarity + contentTypeSimilarity + tagSimilarity);
}

/**
 * Debug utility to get versioning logs from sessionStorage
 */
export function getVersioningDebugLogs(): any[] {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      return JSON.parse(sessionStorage.getItem('versioningLogs') || '[]');
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Debug utility to clear versioning logs
 */
export function clearVersioningDebugLogs(): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    sessionStorage.removeItem('versioningLogs');
  }
  log.info('Versioning debug logs cleared');
}

/**
 * Debug utility to trace a specific operation
 */
export function traceVersioningOperation(operationId: string): any[] {
  const logs = getVersioningDebugLogs();
  return logs.filter(log => log.operationId === operationId);
}


/**
 * Gets the latest version from a list of similar apps
 */
function getLatestVersion(similarApps: SimilarApp[], baseName: string): SimilarApp | null {
  const sameBaseApps = similarApps.filter(app => 
    app.versionInfo && 
    app.versionInfo.baseName.toLowerCase() === baseName.toLowerCase()
  );

  if (sameBaseApps.length === 0) return null;

  return sameBaseApps.reduce((latest, current) => {
    if (!latest.versionInfo || !current.versionInfo) return latest;
    return current.versionInfo.versionNumber > latest.versionInfo.versionNumber ? current : latest;
  });
}

/**
 * Determines if a modification request is minor
 */
function isMinorModification(modificationRequest: string): boolean {
  const minorKeywords = [
    'fix', 'bug', 'typo', 'color', 'style', 'css', 'minor', 'small', 
    'adjust', 'tweak', 'polish', 'improve', 'optimize', 'clean'
  ];
  
  const majorKeywords = [
    'add', 'new', 'feature', 'functionality', 'complete', 'rewrite',
    'replace', 'remove', 'delete', 'major'
  ];
  
  const request = modificationRequest.toLowerCase();
  const minorScore = minorKeywords.filter(keyword => request.includes(keyword)).length;
  const majorScore = majorKeywords.filter(keyword => request.includes(keyword)).length;
  
  return minorScore > majorScore && request.length < 100; // Short requests tend to be minor
}