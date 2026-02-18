/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

/**
 * Enhanced applet actions with user naming, semantic search, and context management
 * 
 * This module extends the base HTML generation actions with:
 * - User-controlled naming with AI suggestions
 * - Semantic search and retrieval
 * - Context-aware modifications
 * - Enhanced CRUD operations
 */

import { randomUUID } from 'crypto';

import {
    buildLibraryAppendix, buildStorageLibraryAppendix, resolveLibraryTemplate,
    summarizeLibraryOptions
} from '@nia/features';
import { Prism } from '@nia/prism';
import {
    getAssistantByName, getAssistantBySubDomain
} from '@nia/prism/core/actions/assistant-actions';
import { getUserSharedResources } from '@nia/prism/core/actions/organization-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';

import {
    findNoteById, findNotesByUserAndTitle
} from '@interface/features/Notes/actions/notes-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { sendBotMessage } from '@interface/lib/bot-messaging-server';
import { getLogger } from '@interface/lib/logger';

import { HtmlGenerationDefinition } from '../definition';
import { parseSearchQuery, searchApplets } from '../lib/applet-search';
import {
    createModificationRecord, estimateAppletComplexity, restoreAppletContext
} from '../lib/context-management';
import { generateOpId } from '../lib/diagnostics';
import {
    analyzeNamingIntent, extractSearchKeywords, generateGenericName, generateSemanticTags,
    validateAppletName
} from '../lib/naming-system';
import { generateWithAnthropic, generateWithGemini, generateWithOpenAI } from '../lib/providers';
import {
    analyzeVersioningStrategy, applyVersionRanking, checkVersionConflicts, createVersionMetadata,
    extractBaseNameAndVersion, performSmartSearch
} from '../lib/versioning-system';
import {
    setGenerationCompleted, setGenerationFailed, setGenerationStarted
} from '../routes/status/route';
import {
    CreateAppletResponse, CreateHtmlGenerationRequest, EnhancedHtmlContent,
    ModifyAppletRequest, ModifyAppletResponse, RollbackAppletResponse, SearchAppletsRequest,
    SearchAppletsResponse
} from '../types/html-generation-types';

import { createHtmlContent, ensureHtmlGenerationDefinition } from './html-generation-actions';

const log = getLogger('[html-generation.enhanced-applet-actions]');

/**
 * Resolves the tenantId from an assistantName.
 * This is the ONLY correct way to determine tenantId for applet operations.
 * 
 * IMPORTANT: Never use userId as tenantId - they are separate concepts.
 * - tenantId: The organization/assistant scope for data isolation
 * - userId: The user performing the operation
 * 
 * @throws Error if assistantName is not provided or assistant is not found
 */
export async function resolveAssistantTenantId(assistantName: string | undefined): Promise<string> {
  if (!assistantName) {
    throw new Error('assistantName is required to determine tenantId. Cannot fallback to userId.');
  }

  // Try name first, then subdomain
  let assistant = await getAssistantByName(assistantName);
  if (!assistant) {
    try {
      assistant = await getAssistantBySubDomain(assistantName);
    } catch (_) {
      // no-op; handled by not found below
    }
  }

  if (!assistant) {
    throw new Error(`Assistant not found: ${assistantName}`);
  }

  if (!assistant.tenantId) {
    throw new Error(`Assistant '${assistantName}' has no tenantId configured`);
  }

  return assistant.tenantId;
}

async function sendAdminMessage(roomUrl: string | undefined, message: string, tenantId: string) {
  if (!roomUrl) return;

  try {
    await sendBotMessage({
      roomUrl,
      message,
      mode: 'queued',
      senderId: 'system',
      senderName: 'System',
      tenantId
    });
  } catch (error) {
    log.error('Failed to send admin message', { err: error, roomUrl, tenantId });
  }
}

async function cloneSharedApplet(
  source: EnhancedHtmlContent,
  userId: string,
  tenantId: string
): Promise<EnhancedHtmlContent> {
  const now = new Date().toISOString();
  const newId = randomUUID();
  const clonedTitle = `${source.title || 'Applet'} (Copy)`;

  const payload = {
    _id: newId,
    title: clonedTitle,
    contentType: source.contentType,
    htmlContent: source.htmlContent,
    cssContent: (source as any).cssContent,
    jsContent: (source as any).jsContent,
    userRequest: source.userRequest || 'Cloned from shared applet',
    isAiGenerated: source.isAiGenerated ?? false,
    tenantId,
    tags: source.tags || [],
    metadata: {
      ...(source.metadata || {}),
      clonedFrom: source._id || (source as any).id,
      clonedAt: now,
      clonedBy: userId
    }
  } as any;

  const created = await createHtmlContent(payload, tenantId);
  return created as EnhancedHtmlContent;
}

/**
 * Creates a new enhanced applet with user-controlled naming and semantic search
 */
export async function createEnhancedApplet(
  request: CreateHtmlGenerationRequest
): Promise<CreateAppletResponse> {
  const jobId = request.metadata?.jobId || generateOpId();
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    // CRITICAL: tenantId must come from the assistant, NOT the user
    const tenantId = await resolveAssistantTenantId(request.assistantName);
    const userId = session.user.id;
    const prism = await Prism.getInstance();

  // Track job lifecycle for resume/recovery

    const operationId = generateOpId();
    log.info('createEnhancedApplet start', {
      operationId,
      userProvidedName: request.userProvidedName,
      title: request.title,
      requestNameSuggestion: request.requestNameSuggestion,
      userRequestPreview: request.userRequest?.substring(0, 200) + (request.userRequest?.length > 200 ? '...' : ''),
      contentType: request.contentType,
      libraryType: request.library_type,
      libraryTemplateId: request.library_template_id,
      description: request.description,
      features: request.features,
      tenantId,
      userId,
      assistantName: request.assistantName,
      timestamp: new Date().toISOString()
    });

    // CRITICAL: Always ask for name first if no explicit name provided
    if (!request.userProvidedName && !request.title) {
      log.info('createEnhancedApplet: requesting name from user', { operationId });
      
      // Analyze the request to suggest a name
      const namingResult = analyzeNamingIntent(
        request.userRequest,
        request.contentType,
        request.description,
        undefined // Force no user-provided name
      );
      
      const callId = generateOpId();
      return {
        success: true,
        data: {} as EnhancedHtmlContent, // Placeholder
        namingSuggestion: namingResult.suggestedName,
        requiresNameConfirmation: true,
        namePrompt: `I'd like to create a ${request.contentType} for you! What would you like to name this app? I suggest "${namingResult.suggestedName}" based on your request, but you can choose any name you prefer.`,
        callId
      };
    }

    // Analyze naming intent
    const namingResult = analyzeNamingIntent(
      request.userRequest,
      request.contentType,
      request.description,
      request.userProvidedName || request.title // Support both fields
    );

    log.info('createEnhancedApplet naming result', {
      operationId,
      namingResult: {
        suggestedName: namingResult.suggestedName,
        isUserProvided: namingResult.isUserProvided,
        requiresConfirmation: namingResult.requiresConfirmation,
        confidence: (namingResult as any).confidence || 'unknown'
      },
      timestamp: new Date().toISOString()
    });

    // Get existing applets for version conflict checking
    const existingApplets = await listUserApplets(session.user.id, tenantId);

    log.info('createEnhancedApplet existing applets', {
      operationId,
      existingAppletsCount: existingApplets.length,
      existingAppletsPreview: existingApplets.slice(0, 5).map(a => ({ title: a.title, id: (a as any)._id })),
      timestamp: new Date().toISOString()
    });

    // Check for version conflicts with the proposed name
    const versionConflicts = checkVersionConflicts(namingResult.suggestedName, existingApplets);

    log.info('createEnhancedApplet version conflict check', {
      operationId,
      step: 'VERSION_CONFLICT_CHECK',
      input: { proposedName: namingResult.suggestedName },
      output: {
        hasConflicts: versionConflicts.hasConflicts,
        existingVersionsCount: versionConflicts.existingVersions.length,
        baseName: versionConflicts.baseName,
        suggestedVersionName: versionConflicts.suggestedVersionName
      },
      timestamp: new Date().toISOString()
    });

    // If there are version conflicts, prompt the user and route via bot (pipecat) instead of VAPI
    if (versionConflicts.hasConflicts && versionConflicts.userPrompt && request.roomUrl) {
      const callId = generateOpId();

      let conflictMessageSent = false;
      if (request.roomUrl) {
        const conflictMessage = [
          `I found existing versions of "${versionConflicts.baseName}" and need your choice before proceeding.`,
          '',
          versionConflicts.userPrompt,
          '',
          `Reply with one of:`,
          `- "create new version" to use ${versionConflicts.suggestedVersionName}`,
          `- "open existing" and name the version to open`,
          `- "rename to <your name>" to provide a different title.`
        ].join('\n');
        
        log.info('createEnhancedApplet sending version conflict message', {
          operationId,
          roomUrl: request.roomUrl,
          tenantId,
          timestamp: new Date().toISOString()
        });
        void sendAdminMessage(request.roomUrl, conflictMessage, tenantId);
        conflictMessageSent = true;
      } 

      if (conflictMessageSent) {
        return {
          success: false, // Requires user interaction
          data: {} as EnhancedHtmlContent,
          versionConflictPrompt: versionConflicts.userPrompt,
          versionConflictData: {
            baseName: versionConflicts.baseName,
            existingVersions: versionConflicts.existingVersions,
            suggestedVersionName: versionConflicts.suggestedVersionName
          },
          callId,
          jobId
        };
      }
      
      log.warn('createEnhancedApplet no room URL for conflict message', {
        operationId,
        tenantId,
        timestamp: new Date().toISOString()
      });
    }

    // Use the suggested version name (either the original name with v1 or a new version number)
    let finalName = versionConflicts.suggestedVersionName;
    let requiresConfirmation = namingResult.requiresConfirmation;

    log.info('createEnhancedApplet final name determined', {
      operationId,
      step: 'FINAL_NAME_RESOLUTION',
      nameResolution: {
        originalName: namingResult.suggestedName,
        finalName: finalName,
        baseName: versionConflicts.baseName,
        hadVersionConflicts: versionConflicts.hasConflicts,
        requiresConfirmation
      },
      timestamp: new Date().toISOString()
    });

    // Legacy name validation for basic checks (length, characters, etc.)
    const existingNames = existingApplets.map(a => a.title);
    const nameValidation = validateAppletName(finalName, existingNames);

    // Handle basic name validation issues (but not version conflicts, which we've already handled)
    if (!nameValidation.isValid && nameValidation.conflicts.length > 0) {
      const fallbackName = finalName || generateGenericName(request.userRequest || request.description, request.contentType);
      finalName = nameValidation.suggestedAlternatives[0] || `${fallbackName} 2`;
      requiresConfirmation = true;
      log.warn('createEnhancedApplet name conflict resolved', {
        operationId,
        originalName: namingResult.suggestedName,
        conflictedWith: nameValidation.conflicts,
        resolvedName: finalName,
        fallbackUsed: fallbackName,
        timestamp: new Date().toISOString()
      });
    }

    // Ensure finalName is never undefined - use generic name instead of "Untitled"
    if (!finalName) {
      finalName = generateGenericName(request.userRequest || request.description, request.contentType);
      log.warn('createEnhancedApplet finalName undefined, using generic name', {
        operationId,
        originalName: namingResult.suggestedName,
        generatedName: finalName,
        userRequest: request.userRequest?.substring(0, 100),
        contentType: request.contentType,
        timestamp: new Date().toISOString()
      });
    }

    // If user requested name suggestion only, return early for confirmation
    if (request.requestNameSuggestion) {
      log.info('createEnhancedApplet returning name suggestion only', { operationId, finalName });
      const callId = generateOpId();
      return {
        success: true,
        data: {} as EnhancedHtmlContent, // Placeholder
        namingSuggestion: finalName,
        requiresNameConfirmation: true,
        callId
      };
    }

    // Resolve optional library template (appendix-based seeding)
    const libraryResolution = resolveLibraryTemplate(request.library_type, request.library_template_id);
    const selectedLibraryTemplate = libraryResolution.selected;

    if (libraryResolution.needsChoice && libraryResolution.templates.length > 0) {
      const callId = generateOpId();
      const promptLines = [
        'Choose a starter template to continue:',
        ...libraryResolution.templates.map((t, index) => `${index + 1}. ${t.name} (${t.filename}) — ${t.description}`),
        '',
        'Reply with the template number or ID to proceed.'
      ];
      const choicePrompt = promptLines.join('\n');

      if (request.roomUrl) {
        log.info('createEnhancedApplet requesting library template choice', {
          operationId,
          roomUrl: request.roomUrl,
          tenantId,
        });
        void sendAdminMessage(request.roomUrl, choicePrompt, tenantId);
      }

      return {
        success: false,
        data: {} as EnhancedHtmlContent,
        requiresLibraryChoice: true,
        libraryChoicePrompt: choicePrompt,
        libraryOptions: summarizeLibraryOptions(libraryResolution.templates),
        callId,
        jobId
      };
    }

    // Generate the HTML content
    let htmlContent: string;
    let generationError: string | undefined;

    const includeStorageLibrary = request.includeStorageLibrary !== false;
    const appendices: AppendixSpec[] = [];

    if (selectedLibraryTemplate) {
      appendices.push(buildLibraryAppendix(selectedLibraryTemplate));
    }

    if (includeStorageLibrary) {
      appendices.push({
        title: 'STORAGE LIBRARY (NiaAPI helper)',
        note: 'Reference only; prefer NiaAPI over localStorage for persistence.',
        referenceOnly: true,
        body: buildStorageLibraryAppendix({ tenantId, assistantName: request.assistantName })
      });
    }

    await setGenerationStarted(jobId, finalName || namingResult.suggestedName || request.title || 'Untitled', tenantId);

    try {
      htmlContent = await generateAppletContent(request, finalName, tenantId, appendices);
      log.info('createEnhancedApplet generation succeeded', {
        operationId,
        preview: htmlContent.substring(0, 100) + (htmlContent.length > 100 ? '...' : ''),
        length: htmlContent.length
      });
    } catch (error) {
      log.error('createEnhancedApplet generation failed, using placeholder', { err: error, operationId });
      generationError = error instanceof Error ? error.message : String(error);
      htmlContent = getPlaceholderErrorApplet(finalName, generationError);
    }

    // Extract search keywords and semantic tags
    const searchKeywords = extractSearchKeywords(
      finalName,
      request.description,
      request.userRequest,
      request.contentType,
      request.features
    );

    const semanticTags = generateSemanticTags(
      finalName,
      request.description,
      request.userRequest,
      request.contentType
    );

    // Create enhanced applet data with v1 versioning for initial generation
    const now = new Date();
    const allUserApplets = await listUserApplets(session.user.id, tenantId);
    const versionMetadata = createVersionMetadata(finalName, allUserApplets, 'major', true);
    
    log.info('createEnhancedApplet version metadata created', {
      operationId,
      step: 'VERSIONING_METADATA_CREATED',
      input: {
        originalName: finalName,
        isInitialGeneration: true,
        versionStrategy: 'major',
        existingAppletsCount: allUserApplets.length
      },
      output: {
        finalName: versionMetadata.finalName,
        version: versionMetadata.versionInfo.version,
        isInitialGeneration: versionMetadata.versionInfo.isInitialGeneration,
        isFirstVersion: versionMetadata.versionInfo.isFirstVersion,
        baseName: versionMetadata.versionInfo.baseName
      },
      transformation: {
        nameChanged: finalName !== versionMetadata.finalName,
        versionAdded: versionMetadata.finalName.includes(' v1'),
        expectedPattern: `${finalName} v1`
      },
      timestamp: new Date().toISOString()
    });
    
    const enhancedApplet: EnhancedHtmlContent = {
      title: versionMetadata.finalName, // Use v1 version name
      contentType: request.contentType,
      htmlContent,
      userRequest: request.userRequest,
      isAiGenerated: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdBy: session.user.id,
      tenantId,
      tags: request.features || [],
      
      // Enhanced fields
      userProvidedName: request.userProvidedName || request.title,
      aiSuggestedName: namingResult.isUserProvided ? undefined : namingResult.suggestedName,
      nameConfirmed: !requiresConfirmation,
      searchKeywords,
      semanticTags,
      modificationHistory: [],
      contextSize: htmlContent.length,
      requiresAppendix: htmlContent.length > 15000,
      lastAccessed: now,
      accessCount: 1,
      modificationCount: 0,
      
      // Source tracking
      sourceNoteId: request.sourceNoteId,
      
      metadata: {
        aiProvider: request.aiProvider || 'openai',
        aiModel: request.aiModel || 'gpt-5',
        complexity: estimateAppletComplexity(htmlContent),
        hasApiIntegration: htmlContent.includes('fetch(') || htmlContent.includes('/api/'),
        generatedAt: now.toISOString(),
        assistantName: request.assistantName,
        sourceNoteId: request.sourceNoteId,
        generationError: generationError
      }
    };

    // Save to database with schema safety
    const created = await ensureHtmlGenerationDefinition(
      () => prism.create(
        HtmlGenerationDefinition.dataModel.block,
        enhancedApplet,
        tenantId
      ),
      tenantId
    );

    if (!created?.items?.[0]) {
      log.error('createEnhancedApplet failed to create applet in database', { operationId, tenantId });
      await sendAdminMessage(request.roomUrl, 'Applet generation failed, sorry about that.', tenantId);
      throw new Error('Failed to create enhanced applet or placeholder in database');
    }

    const createdId = (created.items[0] as any)?._id || (created.items[0] as any)?.page_id || 'unknown';
    log.info('createEnhancedApplet created applet record', {
      operationId,
      appletId: createdId,
      title: enhancedApplet.title,
      tenantId,
      timestamp: new Date().toISOString()
    });
    await setGenerationCompleted(jobId, createdId, enhancedApplet.title, tenantId, created.items[0]);

    // Success notification
    const applet = created.items[0] as unknown as EnhancedHtmlContent;
    const message = generationError 
      ? `Generation failed, but I've created a placeholder for "${applet.title}". You can try modifying it to fix the issue.`
      : `Generation complete for "${applet.title}", you may open it with a TOOL CALL: bot_load_html_applet({"applet_id":"${applet._id}"}) or bot_load_html_applet({"title":"${applet.title}"})`;
    
    await sendAdminMessage(request.roomUrl, message, tenantId);

    const callId = generateOpId();
    return {
      success: true,
      data: created.items[0] as unknown as EnhancedHtmlContent,
      callId,
      jobId
    };

  } catch (error) {
    log.error('Error creating enhanced applet', { err: error, jobId });
    try {
      const session = await getSessionSafely(undefined, interfaceAuthOptions);
      if (session?.user?.id) {
        await setGenerationFailed(jobId, error instanceof Error ? error.message : 'Unknown error', session.user.id);
      }
    } catch (_) {
      // ignore secondary failures
    }
    throw error;
  }
}

/**
 * Searches applets using semantic matching
 */
export async function searchEnhancedApplets(
  searchRequest: SearchAppletsRequest
): Promise<SearchAppletsResponse> {
  const searchId = generateOpId();
  const startTime = Date.now();
  
  log.info('searchEnhancedApplets start', {
    searchId,
    query: searchRequest.query,
    userId: searchRequest.userId,
    limit: searchRequest.limit,
    includeArchived: searchRequest.includeArchived,
    assistantName: searchRequest.assistantName,
    timestamp: new Date().toISOString()
  });

  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session?.user?.id) {
      log.error('searchEnhancedApplets unauthorized access attempt', { searchId });
      throw new Error('Unauthorized');
    }

    log.info('searchEnhancedApplets user authenticated', { searchId, userId: session.user.id });

    // CRITICAL: tenantId must come from the assistant, NOT the user
    const tenantId = await resolveAssistantTenantId(searchRequest.assistantName);

    // Validate search query
    if (!searchRequest.query || searchRequest.query.trim() === '') {
      log.error('searchEnhancedApplets empty search query provided', { searchId });
      throw new Error('Search query cannot be empty');
    }

    log.info('searchEnhancedApplets query validated', {
      searchId,
      originalQuery: searchRequest.query,
      trimmedLength: searchRequest.query.trim().length
    });

    // Get user's applets
    const fetchStartTime = Date.now();
    const userApplets = await listUserApplets(
      searchRequest.userId || session.user.id,
      tenantId
    );
    const fetchDuration = Date.now() - fetchStartTime;

    log.info('searchEnhancedApplets user applets fetched', {
      searchId,
      totalApplets: userApplets.length,
      fetchDurationMs: fetchDuration,
      appletTitles: userApplets.map(a => a.title).slice(0, 10)
    });

    // Parse the search query
    const parseStartTime = Date.now();
    const parsedQuery = parseSearchQuery(searchRequest.query);
    const parseDuration = Date.now() - parseStartTime;

    log.info('searchEnhancedApplets query parsed', {
      searchId,
      parsedQuery: {
        originalQuery: parsedQuery.originalQuery,
        normalizedQuery: parsedQuery.normalizedQuery,
        searchMethod: parsedQuery.searchMethod,
        contentType: parsedQuery.contentType,
        namePatterns: parsedQuery.namePatterns,
        features: parsedQuery.features,
        temporalIndicators: parsedQuery.temporalIndicators
      },
      parseDurationMs: parseDuration
    });

    // First, check if this is a version-aware search that needs smart handling
    const smartSearchStartTime = Date.now();
    const smartSearchResult = performSmartSearch(searchRequest.query, userApplets);
    const smartSearchDuration = Date.now() - smartSearchStartTime;

    log.info('searchEnhancedApplets smart search completed', {
      searchId,
      step: 'SMART_SEARCH_ANALYSIS',
      smartSearchResult: {
        hasMultipleVersions: smartSearchResult.hasMultipleVersions,
        versionsFound: smartSearchResult.versions.length,
        baseName: smartSearchResult.baseName,
        suggestedAction: smartSearchResult.suggestedAction
      },
      smartSearchDurationMs: smartSearchDuration,
      timestamp: new Date().toISOString()
    });

    // If smart search found version conflicts or specific version matches, handle them
    if (smartSearchResult.suggestedAction === 'show_versions' && smartSearchResult.userPrompt) {
      log.info('searchEnhancedApplets prompting for version selection', {
        searchId,
        step: 'VERSION_SELECTION_PROMPT',
        decision: 'USER_CHOICE_REQUIRED',
        versionsFound: smartSearchResult.versions.length,
        timestamp: new Date().toISOString()
      });

      const totalDuration = Date.now() - startTime;
      return {
        success: true,
        results: [],
        totalCount: 0,
        searchMetadata: {
          queryProcessed: searchRequest.query,
          searchMethod: 'semantic' as const,
          filters: {
            ...(searchRequest.contentType && { contentType: searchRequest.contentType })
          },
          searchId,
          query: searchRequest.query,
          parsedQuery: parsedQuery,
          searchDurationMs: totalDuration,
          versionRankingApplied: false,
          smartSearchUsed: true
        },
        versionPrompt: smartSearchResult.userPrompt,
        versionOptions: smartSearchResult.versions
      };
    }

    if (smartSearchResult.suggestedAction === 'open_latest' && smartSearchResult.versions.length === 1) {
      log.info('searchEnhancedApplets single version found', {
        searchId,
        step: 'SINGLE_VERSION_DIRECT_RETURN',
        foundApplet: smartSearchResult.versions[0].title,
        timestamp: new Date().toISOString()
      });

      const appletResult = userApplets.find(a => 
        (a as any)._id === smartSearchResult.versions[0].id || 
        (a as any).id === smartSearchResult.versions[0].id
      );

      if (appletResult) {
        const totalDuration = Date.now() - startTime;
        return {
          success: true,
          results: [{
            applet: appletResult,
            relevanceScore: 1.0,
            matchReasons: ['Exact version match'],
            contextSize: appletResult.htmlContent?.length || 0,
            requiresAppendix: (appletResult.htmlContent?.length || 0) > 15000,
            isVersionMatch: true,
            versionInfo: {
              baseName: smartSearchResult.baseName,
              version: smartSearchResult.versions[0].version,
              isLatest: true
            }
          }],
          totalCount: 1,
          searchMetadata: {
            queryProcessed: searchRequest.query,
            searchMethod: 'semantic' as const,
            filters: {
              ...(searchRequest.contentType && { contentType: searchRequest.contentType })
            },
            searchId,
            query: searchRequest.query,
            parsedQuery: parsedQuery,
            searchDurationMs: totalDuration,
            versionRankingApplied: false,
            smartSearchUsed: true
          }
        };
      }
    }

    // Perform semantic search
    const searchStartTime = Date.now();
    const searchOptions = {
      limit: searchRequest.limit,
      includeArchived: searchRequest.includeArchived,
      userId: searchRequest.userId || session.user.id,
      assistantName: searchRequest.assistantName
    };

    log.info('searchEnhancedApplets starting semantic search', {
      searchId,
      searchOptions,
      appletsToSearch: userApplets.length
    });

    const searchResults = searchApplets(
      userApplets,
      parsedQuery,
      searchOptions
    );
    const searchDuration = Date.now() - searchStartTime;

    log.info('searchEnhancedApplets search completed', {
      searchId,
      resultsFound: searchResults.length,
      searchDurationMs: searchDuration,
      topResults: searchResults.slice(0, 5).map(r => ({
        title: r.applet.title,
        score: r.relevanceScore,
        reasons: r.matchReasons.slice(0, 3)
      }))
    });

    // Apply version-aware ranking to prioritize latest versions
    const versionRankedResults = applyVersionRanking(searchResults, {
      prioritizeLatest: true
    });

    const totalDuration = Date.now() - startTime;

    const response = {
      success: true,
      results: versionRankedResults,
      totalCount: versionRankedResults.length,
      searchMetadata: {
        queryProcessed: parsedQuery.normalizedQuery,
        searchMethod: parsedQuery.searchMethod,
        filters: {
          ...parsedQuery.filters,
          ...(searchRequest.contentType && { contentType: searchRequest.contentType })
        },
        versionRankingApplied: true
      }
    };

    log.info('searchEnhancedApplets operation completed', {
      searchId,
      totalDurationMs: totalDuration,
      breakdown: {
        fetchMs: fetchDuration,
        parseMs: parseDuration,
        searchMs: searchDuration
      },
      success: true,
      resultCount: searchResults.length
    });

    return response;

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    log.error('searchEnhancedApplets operation failed', {
      err: error,
      searchId,
      totalDurationMs: totalDuration,
      query: searchRequest.query,
      userId: searchRequest.userId,
      success: false
    });
    
    throw error;
  }
}

/**
 * Modifies an existing applet with full context awareness and versioning support
 */
export async function modifyEnhancedApplet(
  request: ModifyAppletRequest
): Promise<ModifyAppletResponse & { versioningResult?: any; userPrompt?: string }> {
  const modifyId = generateOpId();
  const jobId = request.metadata?.jobId || generateOpId();
  const startTime = Date.now();

  log.info('modifyEnhancedApplet start', {
    modifyId,
    step: 'MODIFICATION_START',
    input: {
      appletId: request.appletId,
      modificationRequest: request.modificationRequest?.substring(0, 200) + (request.modificationRequest?.length > 200 ? '...' : ''),
      aiProvider: request.aiProvider || 'openai',
      aiModel: request.aiModel || 'gpt-5',
      versioningPreference: request.versioningPreference,
      saveChoice: request.saveChoice,
      assistantName: request.assistantName,
      requestLength: request.modificationRequest?.length || 0
    },
    timestamp: new Date().toISOString()
  });

  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session?.user?.id) {
      log.error('modifyEnhancedApplet unauthorized access attempt', { modifyId });
      throw new Error('Unauthorized');
    }

    log.info('modifyEnhancedApplet user authenticated', { modifyId, userId: session.user.id });

    // CRITICAL: tenantId must come from the assistant, NOT the user
    const tenantId = await resolveAssistantTenantId(request.assistantName);
    const userId = session.user.id;
    const prism = await Prism.getInstance();

    const sharedResources = await getUserSharedResources(userId, tenantId, 'HtmlGeneration');
    const sharedEntry = sharedResources.find(resource => resource.resourceId === request.appletId);

    let lookupTenantId = tenantId;
    const fetchStart = Date.now();
    let existing = await ensureHtmlGenerationDefinition(
      () => prism.query({
        contentType: HtmlGenerationDefinition.dataModel.block,
        tenantId: lookupTenantId,
        where: { page_id: { eq: request.appletId } }
      }),
      lookupTenantId
    );

    if ((!existing?.items || existing.items.length === 0) && sharedEntry?.organization?.tenantId) {
      lookupTenantId = sharedEntry.organization.tenantId;
      existing = await ensureHtmlGenerationDefinition(
        () => prism.query({
          contentType: HtmlGenerationDefinition.dataModel.block,
          tenantId: lookupTenantId,
          where: { page_id: { eq: request.appletId } }
        }),
        lookupTenantId
      );
    }

    const fetchDuration = Date.now() - fetchStart;

    log.info('modifyEnhancedApplet applet fetch completed', {
      modifyId,
      fetchDurationMs: fetchDuration,
      found: !!existing?.items?.[0]
    });

    if (!existing?.items?.[0]) {
      log.error('modifyEnhancedApplet applet not found', {
        modifyId,
        appletId: request.appletId,
        tenantId: lookupTenantId
      });
      throw new Error('Applet not found');
    }

    let applet = existing.items[0] as unknown as EnhancedHtmlContent;

    await setGenerationStarted(jobId, applet.title, tenantId);

    log.info('modifyEnhancedApplet applet details', {
      modifyId,
      title: applet.title,
      contentType: applet.contentType,
      contentSize: applet.htmlContent?.length || 0,
      lastModified: applet.updatedAt,
      modificationCount: applet.modificationCount || 0
    });

    // Verify that the user can edit this applet
    if (applet.createdBy === session.user.id) {
      log.info('modifyEnhancedApplet user is owner', { modifyId, appletId: request.appletId });
    } else if (sharedEntry) {
      const hasWriteAccess = sharedEntry.role !== OrganizationRole.VIEWER;
      if (hasWriteAccess) {
        log.info('modifyEnhancedApplet user has shared write access', {
          modifyId,
          appletId: request.appletId,
          appletCreatedBy: applet.createdBy,
          userId: session.user.id
        });
      } else {
        log.info('modifyEnhancedApplet applet read-only; cloning', {
          modifyId,
          appletId: request.appletId,
          appletCreatedBy: applet.createdBy,
          userId: session.user.id,
          sourceTenantId: lookupTenantId
        });
        const clonedApplet = await cloneSharedApplet(applet, session.user.id, tenantId);
        applet = clonedApplet;
        request.appletId = clonedApplet._id || request.appletId;
      }
    } else {
      log.error('modifyEnhancedApplet unauthorized to modify applet', {
        modifyId,
        appletId: request.appletId,
        appletCreatedBy: applet.createdBy,
        userId: session.user.id
      });
      throw new Error('Unauthorized to modify this applet');
    }

    // Resolve source note if provided
    if (request.sourceNoteId || request.sourceNoteTitle) {
      log.info('modifyEnhancedApplet resolving source note', {
        modifyId,
        sourceNoteId: request.sourceNoteId,
        sourceNoteTitle: request.sourceNoteTitle
      });

      let note = null;
      if (request.sourceNoteId) {
        note = await findNoteById(request.sourceNoteId, tenantId);
      } else if (request.sourceNoteTitle) {
        const notes = await findNotesByUserAndTitle(session.user.id, tenantId, request.sourceNoteTitle);
        if (notes && notes.length > 0) {
          note = notes[0];
        }
      }

      if (note) {
        log.info('modifyEnhancedApplet source note resolved', {
          modifyId,
          noteId: note._id,
          noteTitle: note.title,
          contentLength: note.content?.length || 0
        });

        // Append note content to modification request
        request.modificationRequest = `${request.modificationRequest}\n\n[CONTEXT FROM NOTE "${note.title}":]\n${note.content}`;
        
        // Update sourceNoteId if we found it via title, for metadata tracking
        if (!request.sourceNoteId && note._id) {
          request.sourceNoteId = note._id;
        }
      } else {
        log.warn('modifyEnhancedApplet source note not found', {
          modifyId,
          sourceNoteId: request.sourceNoteId,
          sourceNoteTitle: request.sourceNoteTitle
        });
      }
    }

    // Get all user applets for versioning analysis
    const allUserApplets = await listUserApplets(session.user.id, tenantId);
    
    // Analyze versioning strategy
    const versioningResult = analyzeVersioningStrategy(
      applet,
      request.modificationRequest,
      allUserApplets,
      {
        userPreference: request.versioningPreference,
        similarityThreshold: 0.7,
        maxVersionsToConsider: 20
      }
    );

    log.info('modifyEnhancedApplet versioning analysis completed', {
      modifyId,
      step: 'VERSIONING_ANALYSIS_COMPLETE',
      input: {
        currentAppletTitle: applet.title,
        modificationRequest: request.modificationRequest?.substring(0, 100),
        userPreference: request.versioningPreference,
        allUserAppletsCount: allUserApplets.length
      },
      output: {
        shouldCreateNewVersion: versioningResult.shouldCreateNewVersion,
        versionStrategy: versioningResult.versionStrategy,
        suggestedName: versioningResult.suggestedName,
        similarAppsFound: versioningResult.similarApps.length,
        hasUserPrompt: !!versioningResult.userPrompt,
        metadata: versioningResult.metadata
      },
      analysis: {
        changeType: versioningResult.metadata?.changeType,
        nextMinorVersion: versioningResult.metadata?.nextMinorVersion,
        nextMajorVersion: versioningResult.metadata?.nextMajorVersion,
        recommendedChoice: versioningResult.metadata?.recommendedChoice
      },
      timestamp: new Date().toISOString()
    });

    // Determine the model/provider configuration
    const assistantRecord = await getAssistantByName(request.assistantName!) || await getAssistantBySubDomain(request.assistantName!);
    const generationModelConfig = assistantRecord?.generationModelConfig || [{ provider: 'openai', model: 'gpt-5' }];

    // If user hasn't provided a save choice, pause and ask via bot (pipecat) instead of proceeding automatically
    if (!request.saveChoice && versioningResult.userPrompt) {
      // Step 1-3: Generate the modified content and show to user for confirmation
      const contextResult = restoreAppletContext(applet, request.modificationRequest);
      const modifiedContent = await generateModifiedContent(
        contextResult,
        generationModelConfig,
        request.roomUrl,
        session.user.id,
        applet.title
      );
      
      // Create a temporary modified applet to show the user
      const previewApplet = {
        ...applet,
        htmlContent: modifiedContent,
        title: applet.title + ' (Preview)'
      };

      await setGenerationCompleted(jobId, applet._id || request.appletId, previewApplet.title, tenantId, previewApplet);
      
      const versionInfo = extractBaseNameAndVersion(applet.title);
      const promptMessage = [
        `I finished a preview for "${applet.title}" and need your decision.`,
        '',
        versioningResult.userPrompt,
        '',
        `Reply with one of:`,
        `- "save to original" to apply as ${versioningResult.metadata?.nextMinorVersion || 'the current applet'}`,
        `- "create new version" to save as ${versioningResult.metadata?.nextMajorVersion ? `${versionInfo.baseName} ${versioningResult.metadata.nextMajorVersion}` : 'a new version'}`
      ].join('\n');

      if (request.roomUrl) {
        void sendAdminMessage(request.roomUrl, promptMessage, tenantId);
      }

      return {
        success: false,
        data: previewApplet,
        contextMethod: contextResult.method,
        changesDescription: 'Preview of modifications - awaiting user save choice',
        modificationId: generateOpId(),
        jobId,
        versioningResult: {
          action: 'awaiting_save_choice' as const,
          suggestedName: versioningResult.suggestedName || applet.title,
          baseAppName: versionInfo.baseName,
          versionNumber: versionInfo.version || 'v1',
          similarApps: versioningResult.similarApps.map(app => ({
            id: app.applet._id || '',
            title: app.applet.title,
            version: app.versionInfo?.version || 'v1',
            isLatest: app.versionInfo?.isLatest || false
          }))
        },
        userPrompt: versioningResult.userPrompt,
        metadata: versioningResult.metadata
      };
    }

    // Determine save action based on user's save choice
    let shouldCreateNewVersion = false;
    let finalVersionName = applet.title;
    
    if (request.saveChoice) {
      log.info('modifyEnhancedApplet processing user save choice', {
        modifyId,
        step: 'SAVE_CHOICE_PROCESSING',
        input: {
          saveChoice: request.saveChoice,
          changeType: versioningResult.metadata?.changeType,
          currentAppletTitle: applet.title,
          nextMinorVersion: versioningResult.metadata?.nextMinorVersion,
          nextMajorVersion: versioningResult.metadata?.nextMajorVersion,
          hasPreviewContent: !!(request as any)._previewContent
        },
        decision: {
          willCreateNewVersion: request.saveChoice === 'new_version',
          willModifyExisting: request.saveChoice === 'original'
        },
        timestamp: new Date().toISOString()
      });
      
      // New version means new MAJOR version (new applet will be created)
      if (request.saveChoice === 'new_version') {
        // User chose to create new version
        shouldCreateNewVersion = true;
        finalVersionName = versioningResult.metadata?.nextMajorVersion 
          ? `${versioningResult.metadata.baseAppDetected} ${versioningResult.metadata.nextMajorVersion}`
          : versioningResult.suggestedName || `${applet.title} v2`;
      // Original means new MINOR version (on the existing applet)
      } else if (request.saveChoice === 'original') {
        // User chose to save to original (with minor version increment)
        shouldCreateNewVersion = false;
        finalVersionName = versioningResult.metadata?.nextMinorVersion 
          ? `${versioningResult.metadata.baseAppDetected} ${versioningResult.metadata.nextMinorVersion}`
          : applet.title;
      }
    } else {
      // Fallback to versioning result (legacy behavior)
      shouldCreateNewVersion = versioningResult.shouldCreateNewVersion;
    }

    // Check if preview content was provided (to avoid double generation)
    const previewContent = (request as any)._previewContent;
    let modifiedContent: string;
    let contextResult: any;
    let contextDuration = 0;
    let aiDuration = 0;
    
    if (previewContent && typeof previewContent === 'string') {
      log.info('modifyEnhancedApplet using preview content', {
        modifyId,
        previewContentSize: previewContent.length,
        optimization: 'Avoided duplicate AI generation'
      });
      
      modifiedContent = previewContent;
      contextResult = { method: 'preview-reused' }; // Placeholder for when preview is reused
    } else {
      // Restore context for AI modification
      const contextStart = Date.now();
      contextResult = restoreAppletContext(
        applet,
        request.modificationRequest,
        request.aiProvider || 'openai',
        request.aiModel || 'gpt-5'
      );
      contextDuration = Date.now() - contextStart;

      log.info('modifyEnhancedApplet context restoration completed', {
        modifyId,
        contextMethod: contextResult.method,
        contextDurationMs: contextDuration,
        promptLength: contextResult.contextPrompt?.length || 0,
        hasAppendix: contextResult.appendixContent ? contextResult.appendixContent.length > 0 : false
      });

      // Generate modified content using AI
      const aiStart = Date.now();
      modifiedContent = await generateModifiedContent(
        contextResult,
        generationModelConfig,
        request.roomUrl,
        session.user.id,
        applet.title
      );
      aiDuration = Date.now() - aiStart;

      log.info('modifyEnhancedApplet AI modification completed', {
        modifyId,
        aiDurationMs: aiDuration,
        originalContentSize: applet.htmlContent?.length || 0,
        modifiedContentSize: modifiedContent.length,
        sizeDelta: modifiedContent.length - (applet.htmlContent?.length || 0)
      });
    }

    // Create modification record
    const modificationRecord = createModificationRecord(
      request,
      shouldCreateNewVersion ? 'Created new version with modifications' : 'Applied user-requested modifications',
      contextResult.method,
      applet.htmlContent || '',
      applet.title
    );

    log.info('modifyEnhancedApplet modification record created', {
      modifyId,
      recordId: modificationRecord.id,
      timestamp: modificationRecord.timestamp,
      isNewVersion: shouldCreateNewVersion,
      priorHtmlContent: applet.htmlContent ? `len:${applet.htmlContent.length}` : 'none',
      priorTitle: applet.title
    });

    let finalApplet: EnhancedHtmlContent;

    if (shouldCreateNewVersion) {
      // CREATE NEW VERSION
      const newVersionName = finalVersionName;
      
      finalApplet = {
        ...applet,
        title: newVersionName,
        htmlContent: modifiedContent,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        modificationHistory: [modificationRecord], // Fresh history for new version
        contextSize: modifiedContent.length,
        requiresAppendix: modifiedContent.length > 15000,
        lastAccessed: new Date(),
        accessCount: 1, // Reset for new version
        modificationCount: 0, // Reset for new version
        
        // Enhanced fields for version tracking
        userProvidedName: newVersionName,
        aiSuggestedName: undefined,
        nameConfirmed: true,
        searchKeywords: extractSearchKeywords(
          newVersionName,
          request.modificationRequest,
          request.modificationRequest,
          applet.contentType,
          applet.tags || []
        ),
        semanticTags: generateSemanticTags(
          newVersionName,
          request.modificationRequest,
          request.modificationRequest,
          applet.contentType
        )
      };

      // Remove the ID so Prism creates a new record
      delete (finalApplet as any).id;
      delete (finalApplet as any)._id;
      delete (finalApplet as any).page_id;

      log.info('modifyEnhancedApplet creating new version', {
        modifyId,
        originalTitle: applet.title,
        newTitle: newVersionName,
        versionStrategy: versioningResult.versionStrategy
      });
    } else {
      // MODIFY EXISTING
      finalApplet = {
        ...applet,
        title: finalVersionName, // Update title with version increment
        htmlContent: modifiedContent,
        updatedAt: new Date().toISOString(),
        modificationHistory: [
          ...(applet.modificationHistory || []),
          modificationRecord
        ],
        contextSize: modifiedContent.length,
        requiresAppendix: modifiedContent.length > 15000,
        lastAccessed: new Date(),
        accessCount: applet.accessCount + 1,
        modificationCount: applet.modificationCount + 1
      };

      log.info('modifyEnhancedApplet modifying existing applet', {
        modifyId,
        title: applet.title,
        newModificationCount: finalApplet.modificationCount
      });
    }

    // Save applet (create new or update existing)
    const saveStart = Date.now();
    let updated: any;
    
    if (shouldCreateNewVersion) {
      updated = await ensureHtmlGenerationDefinition(
        () => prism.create(
          HtmlGenerationDefinition.dataModel.block,
          finalApplet,
          tenantId
        ),
        tenantId
      );
    } else {
      updated = await ensureHtmlGenerationDefinition(
        () => prism.update(
          HtmlGenerationDefinition.dataModel.block,
          request.appletId,
          finalApplet,
          tenantId
        ),
        tenantId
      );
    }

    const saveDuration = Date.now() - saveStart;

    log.info('modifyEnhancedApplet applet saved', {
      modifyId,
      saveDurationMs: saveDuration,
      success: !!updated?.items?.[0]
    });

    if (!updated?.items?.[0]) {
      log.error('modifyEnhancedApplet failed to save updated applet', { modifyId });
      throw new Error('Failed to update applet');
    }

    const updatedId = (updated.items[0] as any)?._id || (updated.items[0] as any)?.page_id || request.appletId;
    await setGenerationCompleted(jobId, updatedId, finalApplet.title, tenantId, updated.items[0]);

    // Success notification
    const updatedApplet = updated?.items?.[0] as unknown as EnhancedHtmlContent;
    const finalName = updatedApplet.title;
    // Note: modifyEnhancedApplet doesn't currently have a generationError variable in scope like createEnhancedApplet
    // If we add error handling that produces placeholders here, we should update this message logic too.
    await sendAdminMessage(request.roomUrl, `Generation complete for "${updatedApplet.title}", you may open it with a TOOL CALL: bot_load_html_applet({"applet_id":"${updatedApplet._id}"}) or bot_load_html_applet({"title":"${updatedApplet.title}"})`, tenantId);

    const totalDuration = Date.now() - startTime;
    const finalModificationId = generateOpId();

    log.info('modifyEnhancedApplet completed', {
      modifyId,
      finalModificationId,
      totalDurationMs: totalDuration,
      breakdown: {
        fetchMs: fetchDuration,
        contextMs: contextDuration,
        aiMs: aiDuration,
        saveMs: saveDuration
      },
      success: true,
      newModificationCount: finalApplet.modificationCount
    });

    const finalVersionInfo = extractBaseNameAndVersion(
      shouldCreateNewVersion ? (versioningResult.suggestedName || updatedApplet.title) : updatedApplet.title
    );
    
    return {
      success: true,
      data: updated.items[0] as unknown as EnhancedHtmlContent,
      contextMethod: contextResult.method,
      changesDescription: shouldCreateNewVersion ? 
        `Created new version: ${versioningResult.suggestedName}` : 
        'Applied user-requested modifications',
      modificationId: finalModificationId,
      jobId,
      versioningResult: {
        action: shouldCreateNewVersion ? 'create_new_version' as const : 'modify_existing' as const,
        suggestedName: shouldCreateNewVersion ? (versioningResult.suggestedName || updatedApplet.title) : updatedApplet.title,
        baseAppName: finalVersionInfo.baseName,
        versionNumber: finalVersionInfo.version || 'v1',
        similarApps: versioningResult.similarApps.map(app => ({
          id: app.applet._id || '',
          title: app.applet.title,
          version: app.versionInfo?.version || 'v1',
          isLatest: app.versionInfo?.isLatest || false
        }))
      }
    };

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    log.error('modifyEnhancedApplet failed', {
      err: error,
      modifyId,
      totalDurationMs: totalDuration,
      appletId: request.appletId,
      modificationRequest: request.modificationRequest,
      success: false
    });

    try {
      const session = await getSessionSafely(undefined, interfaceAuthOptions);
      if (session?.user?.id) {
        await setGenerationFailed(jobId, error instanceof Error ? error.message : 'Unknown error', session.user.id);
      }
    } catch (_) {
      // ignore secondary failures
    }
    
    throw error;
  }
}

/**
 * Gets an enhanced applet by ID with access tracking
 * @param appletId - The applet ID to fetch
 * @param assistantName - The assistant name to resolve tenantId from (required)
 */
export async function getEnhancedApplet(appletId: string, assistantName: string): Promise<EnhancedHtmlContent | null> {
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    // CRITICAL: tenantId must come from the assistant, NOT the user
    const tenantId = await resolveAssistantTenantId(assistantName);
    const prism = await Prism.getInstance();

    const result = await ensureHtmlGenerationDefinition(
      () => prism.query({
        contentType: HtmlGenerationDefinition.dataModel.block,
        tenantId,
        where: { page_id: { eq: appletId } }
      }),
      tenantId
    );

    if (!result?.items?.[0]) {
      return null;
    }

    const applet = result.items[0] as unknown as EnhancedHtmlContent;

    // Update access tracking
    const updatedApplet: EnhancedHtmlContent = {
      ...applet,
      lastAccessed: new Date(),
      accessCount: applet.accessCount + 1
    };

    // Update access count in background (don't await)
    ensureHtmlGenerationDefinition(
      () => prism.update(
        HtmlGenerationDefinition.dataModel.block,
        appletId,
        updatedApplet,
        tenantId
      ),
      tenantId
    ).catch(error => {
      log.warn('Failed to update access count', { err: error, appletId });
    });

    return applet;

  } catch (error) {
    log.error('Error getting enhanced applet', { err: error, appletId });
    throw error;
  }
}

/**
 * Lists user's applets with enhanced metadata
 */
async function listUserApplets(userId: string, tenantId: string): Promise<EnhancedHtmlContent[]> {
  const prism = await Prism.getInstance();
  
  const result = await ensureHtmlGenerationDefinition(
    () => prism.query({
      contentType: HtmlGenerationDefinition.dataModel.block,
      tenantId,
      where: { parent_id: { eq: userId } },
      orderBy: { createdAt: 'desc' as const },
      limit: 100
    }),
    tenantId
  );

  // Convert legacy applets to enhanced format for compatibility
  return (result?.items || []).map((item: any): EnhancedHtmlContent => {
    const now = new Date();
    return {
      ...item,
      // Ensure title is always set
      title: item.title || 'Untitled',
      // Ensure enhanced fields exist with defaults
      userProvidedName: item.userProvidedName || item.title,
      aiSuggestedName: item.aiSuggestedName,
      nameConfirmed: item.nameConfirmed ?? true,
      searchKeywords: item.searchKeywords || extractSearchKeywords(
        item.title || 'Untitled',
        item.userRequest || '',
        item.userRequest || '',
        item.contentType || 'interactive',
        item.tags || []
      ),
      semanticTags: item.semanticTags || generateSemanticTags(
        item.title || 'Untitled',
        item.userRequest || '',
        item.userRequest || '',
        item.contentType || 'interactive'
      ),
      modificationHistory: item.modificationHistory || [],
      contextSize: item.contextSize || (item.htmlContent?.length || 0),
      requiresAppendix: item.requiresAppendix ?? ((item.htmlContent?.length || 0) > 15000),
      lastAccessed: item.lastAccessed ? new Date(item.lastAccessed) : now,
      accessCount: item.accessCount || 1,
      modificationCount: item.modificationCount || 0,
      
      metadata: {
        aiProvider: item.metadata?.aiProvider || 'openai',
        aiModel: item.metadata?.aiModel || 'gpt-5',
        complexity: item.metadata?.complexity || estimateAppletComplexity(item.htmlContent || ''),
        hasApiIntegration: item.metadata?.hasApiIntegration ?? (item.htmlContent?.includes('fetch(') || item.htmlContent?.includes('/api/')),
        generatedAt: item.metadata?.generatedAt || now.toISOString(),
        assistantName: item.metadata?.assistantName
      }
    };
  });
}

type AppendixSpec = {
  title: string;
  body: string;
  referenceOnly?: boolean;
  note?: string;
};

function getPlaceholderErrorApplet(title: string, error: string = 'Unknown error'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generation Failed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            color: #ffffff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            text-align: center;
        }
        .container {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 40px;
            max-width: 600px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
        }
        h1 {
            font-size: 24px;
            margin-bottom: 16px;
            color: #ff6b6b;
        }
        p {
            font-size: 16px;
            line-height: 1.5;
            margin-bottom: 24px;
            color: #e0e0e0;
        }
        .error-details {
            background: rgba(0, 0, 0, 0.3);
            padding: 16px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 14px;
            color: #ff8787;
            text-align: left;
            overflow-x: auto;
            margin-bottom: 24px;
            border: 1px solid rgba(255, 107, 107, 0.2);
            max-height: 200px;
            overflow-y: auto;
        }
        .icon {
            font-size: 48px;
            margin-bottom: 24px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">⚠️</div>
        <h1>App Generation Failed</h1>
        <p>We attempted to create "<strong>${title}</strong>", but the AI provider encountered an error.</p>
        <div class="error-details">
            ${error.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </div>
        <p>You can try asking again with a slightly different description.</p>
    </div>
</body>
</html>`;
}

/**
 * Generates HTML content for the applet
 */
async function generateAppletContent(
  request: CreateHtmlGenerationRequest,
  finalName: string,
  tenantId: string,
  appendices: AppendixSpec[] = []
): Promise<string> {
  const opId = generateOpId();
  const prompt = createEnhancedGenerationPrompt(request, finalName, appendices);

  // Determine the model/provider configuration
  const assistantRecord = await getAssistantByName(request.assistantName!) || await getAssistantBySubDomain(request.assistantName!);
  const generationModelConfig = assistantRecord?.generationModelConfig || [{ provider: 'openai', model: 'gpt-5' }];

  let lastError: Error | null = null;
  for (let i = 0; i < generationModelConfig.length; i++) {
    const config = generationModelConfig[i];
    const { provider, model } = config;
    log.info('generateAppletContent attempting provider', { opId, provider, model });
    // Model-specific token limits to avoid API errors
    const getMaxTokens = (provider: string, model?: string): number => {
      log.debug('generateAppletContent calculating maxTokens', { provider, model });
      if (provider === 'openai') {
        if (model === 'gpt-5-codex' || model === 'gpt-5.1-codex-max') return 16000; // Codex supports very high limits
        if (model === 'gpt-5' || model === 'gpt-5-mini' || model === 'gpt-5-nano' || model === 'o3') return 12000; // New models support higher limits
        if (model === 'gpt-4-turbo') return 4096; // gpt-4-turbo has 4096 max output tokens
        if (model === 'gpt-3.5-turbo') return 4096; // gpt-3.5-turbo has 4096 max output tokens
        return 8000; // gpt-4o and gpt-4o-mini support higher limits
      }
      if (provider === 'anthropic') {
        if (model === 'claude-sonnet-4-20250514') return 12000; // New Sonnet 4 supports higher limits
        return 8000; // Other Claude models support 8000+ output tokens
      }
      if (provider === 'gemini') {
        return 8000; // Gemini supports 8000+ output tokens
      }
      return 4096; // Safe default
    };

    const maxTokens = getMaxTokens(provider, model);
    log.info('generateAppletContent using maxTokens', { opId, provider, model, maxTokens });

    try {
      let result: string;
      switch (provider) {
        case 'openai':
          result = await generateWithOpenAI(prompt, { model, maxTokens, opId });
          break;
        case 'gemini':
        case 'google':
          result = await generateWithGemini(prompt, { model, maxTokens, opId });
          break;
        default:
          result = await generateWithAnthropic(prompt, { model, maxTokens, opId });
          break;
      }
      return result;
    } catch (error) {
      log.error('generateAppletContent AI generation failed', { err: error, opId, provider, model });
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Retry notification
      await sendAdminMessage(request.roomUrl, "Had a problem generating that, trying another way...", tenantId);
      
      // Try the next model in the configuration
      continue;
    }
  }
  if (lastError) {
    // Failure notification
    await sendAdminMessage(request.roomUrl, "Sorry, we couldn't get that done for you.", tenantId);
    throw lastError;
  } else {
    await sendAdminMessage(request.roomUrl, "Sorry, we couldn't get that done for you.", tenantId);
    throw new Error('No generation models configured');
  }
}

/**
 * Generates modified content using AI with context
 */
export async function generateModifiedContent(
  contextResult: any,
  generationModelConfig: { provider: string; model?: string }[],
  roomUrl?: string,
  tenantId?: string,
  title?: string
): Promise<string> {
  const opId = generateOpId();

  let lastError: Error | null = null;
  for (const config of generationModelConfig) {
    if (lastError) {       
      // Retry notification
      if (roomUrl && tenantId) {
        await sendAdminMessage(roomUrl, "Had a problem generating that, trying another way...", tenantId);
      }
    }
    log.info('generateModifiedContent attempting provider', { opId, provider: config.provider, model: config.model });
    // Model-specific token limits to avoid API errors
    const { provider, model } = config;
    const getMaxTokens = (provider: string, model?: string): number => {
      log.debug('generateModifiedContent calculating maxTokens', { provider, model });
      if (provider === 'openai') {
        if (model === 'gpt-5-codex' || model === 'gpt-5.1-codex-max') return 16000; // Codex supports very high limits
        if (model === 'gpt-5' || model === 'gpt-5-mini' || model === 'gpt-5-nano' || model === 'o3') return 12000; // New models support higher limits
        if (model === 'gpt-4-turbo') return 4096; // gpt-4-turbo has 4096 max output tokens
        if (model === 'gpt-3.5-turbo') return 4096; // gpt-3.5-turbo has 4096 max output tokens
        return 8000; // gpt-4o and gpt-4o-mini support higher limits
      }
      if (provider === 'anthropic') {
        if (model === 'claude-sonnet-4-20250514') return 12000; // New Sonnet 4 supports higher limits
        return 8000; // Other Claude models support 8000+ output tokens
      }
      if (provider === 'gemini') {
        return 8000; // Gemini supports 8000+ output tokens
      }
      return 4096; // Safe default
    };

    const maxTokens = getMaxTokens(provider, model);
    log.info('generateModifiedContent using maxTokens', { opId, provider, model, maxTokens });

    // Inject appendix content if present (critical for large applets)
    let finalPrompt = contextResult.contextPrompt;
    if (contextResult.appendixContent) {
      log.info('generateModifiedContent injecting appendix content', { opId });
      finalPrompt = finalPrompt.replace(
        '[ATTACHED: Complete HTML content in separate context block]', 
        `\n\`\`\`html\n${contextResult.appendixContent}\n\`\`\`\n`
      );
    }

    try {
      let response: string;
      
      switch (provider) {
        case 'openai':
          response = await generateWithOpenAI(finalPrompt, { model, maxTokens, opId });
          break;
        case 'gemini':
        case 'google':
          response = await generateWithGemini(finalPrompt, { model, maxTokens, opId });
          break;
        default:
          response = await generateWithAnthropic(finalPrompt, { model, maxTokens, opId });
          break;
      }
      log.info('generateModifiedContent AI modification succeeded', {
        opId,
        provider,
        model,
        preview: response.substring(0, 100) + (response.length > 100 ? '...' : ''),
        length: response.length
      });

      // Extract HTML from response if it contains other content
      const htmlMatch = response.match(/```html\n([\s\S]*?)\n```/) || 
                      response.match(/<!DOCTYPE html>[\s\S]*<\/html>/);
      
      return htmlMatch ? (htmlMatch[1] || htmlMatch[0]) : response;

    } catch (error) {
      log.error('generateModifiedContent failed', { err: error, opId, provider, model });
      lastError = error instanceof Error ? error : new Error(String(error));
      // Try the next model in the configuration
      continue;
    }
  }
  if (lastError) {
    // Failure notification
    if (roomUrl && tenantId) {
      await sendAdminMessage(roomUrl, "Sorry, we couldn't get that done for you.", tenantId);
    }
    throw lastError;
  } else {
    if (roomUrl && tenantId) {
      await sendAdminMessage(roomUrl, "Sorry, we couldn't get that done for you.", tenantId);
    }
    throw new Error('No generation models configured');
  }
}

/**
 * Creates an enhanced generation prompt with naming context
 */
function createEnhancedGenerationPrompt(
  request: CreateHtmlGenerationRequest,
  finalName: string,
  appendices: AppendixSpec[] = []
): string {
  const featuresText = request.features?.length 
    ? `\nSpecific features requested: ${request.features.join(', ')}` 
    : '';

  const appendixListing = appendices.length
    ? `\n\nAPPENDICES:\n${appendices.map((spec, idx) => {
        const label = String.fromCharCode(65 + idx);
        const referenceNote = spec.referenceOnly ? ' (reference only)' : '';
        return `- APPENDIX ${label} - ${spec.title}${referenceNote}`;
      }).join('\n')}\n`
    : '';

  const appendixBlocks = appendices.length
    ? `\n\n${appendices.map((spec, idx) => {
        const label = String.fromCharCode(65 + idx);
        const note = spec.note ? `\n${spec.note}` : '';
        return `### APPENDIX ${label} - ${spec.title}${note}\n${spec.body}`;
      }).join('\n\n')}`
    : '';

  // External resources rule
  const externalResourcesRule = '9. DO NOT use any external resources (no external images, fonts, APIs, or placeholder services)\n10. All visual assets must be created with CSS, SVG, or Canvas - no external URLs';

  return `Create a complete, self-contained HTML file for a ${request.contentType} called "${finalName}".

Description: ${request.description}${featuresText}
Original user request: "${request.userRequest}"

CRITICAL REQUIREMENTS:
1. Create a SINGLE HTML file with embedded CSS and JavaScript
2. Make it visually appealing with modern styling (gradients, shadows, animations)
3. Ensure it's fully functional and interactive
4. Use a beautiful color scheme and responsive design
5. Include proper logic, event handling, and user feedback
6. Add emojis and visual polish
7. Make it mobile-friendly
8. All code must be in ONE file - no external dependencies
${externalResourcesRule}

CRITICAL NAMING RULES:
- The applet will be saved as "${finalName}"
- NEVER include the app title "${finalName}" anywhere in the HTML content
- NO <h1>, <h2>, <header>, or any large title elements with the app name
- NO divs with classes like "title", "heading", "header", "banner" containing the app name  
- The interface displays the title separately - your HTML should start directly with the app functionality
- Do not use the app name in any visible text elements - focus purely on the app's features

HEADING STYLING OVERRIDE (if headings are accidentally created):
- Add this CSS to automatically style any headings that might be created:
h1, h2, h3, h4, h5, h6 {
  position: absolute !important;
  top: 10px !important;
  right: 10px !important;
  font-size: 0.5em !important;
  width: 50% !important;
  max-width: 200px !important;
  text-align: right !important;
  opacity: 0.7 !important;
  z-index: 1000 !important;
  margin: 0 !important;
  padding: 5px !important;
  background: rgba(255,255,255,0.8) !important;
  border-radius: 4px !important;
}

CRITICAL JAVASCRIPT REQUIREMENTS:
- ALL JavaScript functions MUST be defined in the global scope (window object)
- Use window.functionName = function() { ... } for ALL functions
- EVERY button MUST have a working click handler - no decorative buttons allowed
- EVERY form input MUST have proper event handling and validation
- EVERY interactive element MUST actually perform its intended function
- Use addEventListener('click', ...) or onclick with global functions
- Ensure DOMContentLoaded is used for initialization: document.addEventListener('DOMContentLoaded', function() { ... });
- ALL buttons must have meaningful functionality that matches their text/purpose
- Include proper error handling and structured logging for debugging
- Ensure all functions are accessible and properly bound to DOM elements
- NO PLACEHOLDER or non-functional buttons - everything must work

Guidelines:
- For games: Include scoring, game over conditions, restart functionality, controls
- For apps: Include full CRUD operations, use the NiaAPI storage library for persistence (see appendix), and build a nice UI
- For tools: Include multiple features, export/import if relevant
- For interactive: Include engaging animations, feedback, progress tracking

Return ONLY the HTML code, nothing else. Start with <!DOCTYPE html> and end with </html>.${appendixListing}${appendixBlocks}`;
}

/**
 * Rollback an applet to a previous version using its modification history
 * @param appletId - The applet ID to rollback
 * @param assistantName - The assistant name to resolve tenantId from (required)
 * @param steps - Number of versions to rollback (default: 1)
 */
export async function rollbackEnhancedApplet(
  appletId: string,
  assistantName: string,
  steps: number = 1
): Promise<RollbackAppletResponse> {
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    // CRITICAL: tenantId must come from the assistant, NOT the user
    const tenantId = await resolveAssistantTenantId(assistantName);
    const userId = session.user.id;
    const prism = await Prism.getInstance();

    // 1. Fetch the applet
    const result = await ensureHtmlGenerationDefinition(
      () => prism.query({
        contentType: HtmlGenerationDefinition.dataModel.block,
        tenantId,
        where: { page_id: { eq: appletId } }
      }),
      tenantId
    );

    if (!result?.items?.[0]) {
      throw new Error(`Applet with ID ${appletId} not found`);
    }

    const applet = result.items[0] as unknown as EnhancedHtmlContent;

    // 2. Check permissions
    if (applet.createdBy !== userId) {
      // Check shared permissions
      const hasWriteAccess = await getUserSharedResources(
        userId,
        tenantId,
        'HtmlGeneration'
      ).then(resources => 
        resources.some(r => r.resourceId === appletId && r.role !== OrganizationRole.VIEWER)
      );

      if (!hasWriteAccess) {
        throw new Error('Permission denied: You do not have write access to this applet');
      }
    }

    // 3. Validate history
    if (!applet.modificationHistory || applet.modificationHistory.length === 0) {
      throw new Error('No modification history available for rollback');
    }

    if (steps > applet.modificationHistory.length) {
      throw new Error(`Cannot rollback ${steps} steps. Only ${applet.modificationHistory.length} versions available.`);
    }

    // 4. Perform rollback
    // We need to pop 'steps' number of records
    // The last record contains the state BEFORE the last modification
    
    let restoredHtml = applet.htmlContent;
    let restoredTitle = applet.title;
    let restoredId = '';
    
    // Remove the last 'steps' records
    // For each step, we revert to the 'prior' state stored in that record
    for (let i = 0; i < steps; i++) {
      const record = applet.modificationHistory.pop();
      if (record) {
        // Fallback to current value if prior value is missing (legacy records)
        restoredHtml = record.priorHtmlContent || restoredHtml;
        restoredTitle = record.priorTitle || restoredTitle;
        restoredId = record.id;
      }
    }

    // 5. Update the applet
    const updatedApplet = await ensureHtmlGenerationDefinition(
      () => prism.update(
        HtmlGenerationDefinition.dataModel.block,
        appletId,
        {
          htmlContent: restoredHtml,
          title: restoredTitle,
          modificationHistory: applet.modificationHistory as any, // Cast for Prisma JSON compatibility
          updatedAt: new Date()
        },
        tenantId
      ),
      tenantId
    ) as unknown as EnhancedHtmlContent;

    log.info('rollbackEnhancedApplet completed', { appletId, steps });

    return {
      success: true,
      data: updatedApplet,
      restoredVersionId: restoredId,
      stepsRolledBack: steps,
      message: `Successfully rolled back to version from ${new Date().toLocaleTimeString()}`
    };

  } catch (error) {
    log.error('rollbackEnhancedApplet failed', { err: error, appletId, steps });
    throw error;
  }
}
