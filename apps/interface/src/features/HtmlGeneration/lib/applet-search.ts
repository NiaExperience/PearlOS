/**
 * Semantic applet search and retrieval system
 * 
 * This module provides:
 * - Natural language search parsing
 * - Semantic similarity scoring
 * - Fuzzy matching for typos and variations
 * - Temporal and content type filtering
 * - Result ranking and relevance scoring
 */

import { getLogger } from '@interface/lib/logger';

import { 
  AppletSearchCapabilities, 
  AppletSearchResult, 
  EnhancedHtmlContent, 
  HtmlContentType 
} from '../types/html-generation-types';

const log = getLogger('[html-generation.applet-search]');

export interface ParsedSearchQuery {
  originalQuery: string;
  normalizedQuery: string;
  contentType?: HtmlContentType;
  namePatterns: string[];
  features: string[];
  temporalIndicators: string[];
  searchMethod: 'semantic' | 'fuzzy' | 'exact';
  filters: Record<string, any>;
}

export interface SearchOptions {
  limit?: number;
  includeArchived?: boolean;
  userId: string;
  assistantName?: string;
  capabilities?: AppletSearchCapabilities;
}

/**
 * Parses a natural language search query into structured search parameters
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const originalQuery = query.trim();
  const normalizedQuery = query.toLowerCase().trim();
  
  // Extract content type filters
  const contentType = extractContentType(normalizedQuery);
  
  // Extract name patterns
  const namePatterns = extractNamePatterns(normalizedQuery);
  
  // Extract feature keywords
  const features = extractFeatures(normalizedQuery);
  
  // Extract temporal indicators
  const temporalIndicators = extractTemporalIndicators(normalizedQuery);
  
  // Determine search method
  const searchMethod = determineSearchMethod(normalizedQuery, namePatterns);
  
  // Build filters
  const filters = buildSearchFilters(normalizedQuery, contentType, temporalIndicators);
  
  return {
    originalQuery,
    normalizedQuery,
    contentType,
    namePatterns,
    features,
    temporalIndicators,
    searchMethod,
    filters
  };
}

/**
 * Searches applets using semantic matching and ranking
 */
export function searchApplets(
  applets: EnhancedHtmlContent[],
  parsedQuery: ParsedSearchQuery,
  options: SearchOptions
): AppletSearchResult[] {
  log.info('Starting detailed search', {
    totalApplets: applets.length,
    searchMethod: parsedQuery.searchMethod,
    contentType: parsedQuery.contentType,
    namePatterns: parsedQuery.namePatterns,
    features: parsedQuery.features,
    temporalIndicators: parsedQuery.temporalIndicators,
    limit: options.limit || 10,
    includeArchived: options.includeArchived
  });

  const results: AppletSearchResult[] = [];
  const scoringStart = Date.now();
  let belowThresholdCount = 0;
  
  for (const applet of applets) {
    const relevanceData = calculateRelevance(applet, parsedQuery);
    
    log.info('Scored applet', {
      title: applet.title,
      score: relevanceData.score,
      reasons: relevanceData.reasons.slice(0, 3),
      contentType: applet.contentType,
      lastAccessed: applet.lastAccessed
    });
    
    if (relevanceData.score > 0.1) { // Minimum relevance threshold
      results.push({
        applet,
        relevanceScore: relevanceData.score,
        matchReasons: relevanceData.reasons,
        contextSize: applet.htmlContent.length,
        requiresAppendix: applet.htmlContent.length > 15000
      });
    } else {
      belowThresholdCount++;
    }
  }
  
  const scoringDuration = Date.now() - scoringStart;
  
  log.info('Relevance scoring completed', {
    scoringDurationMs: scoringDuration,
    totalScored: applets.length,
    aboveThreshold: results.length,
    belowThreshold: belowThresholdCount,
    averageScore: results.length > 0 ? 
      results.reduce((sum, r) => sum + r.relevanceScore, 0) / results.length : 0
  });
  
  // Sort by relevance score (descending)
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  log.info('Top scoring results', {
    topResults: results.slice(0, Math.min(5, results.length)).map((r, index) => ({
      rank: index + 1,
      title: r.applet.title,
      score: r.relevanceScore,
      topReasons: r.matchReasons.slice(0, 2)
    }))
  });
  
  // Apply limit
  const limit = options.limit || 10;
  const finalResults = results.slice(0, limit);

  log.info('Search completed', {
    finalResultCount: finalResults.length,
    limitApplied: limit,
    totalPossibleResults: results.length
  });

  return finalResults;
}

/**
 * Extracts content type from search query
 */
function extractContentType(query: string): HtmlContentType | undefined {
  const typePatterns: Record<string, HtmlContentType> = {
    'game': 'game',
    'games': 'game',
    'app': 'app',
    'application': 'app',
    'apps': 'app',
    'tool': 'tool',
    'tools': 'tool',
    'utility': 'tool',
    'interactive': 'interactive',
    'demo': 'interactive',
    'presentation': 'interactive'
  };
  
  for (const [pattern, type] of Object.entries(typePatterns)) {
    if (query.includes(pattern)) {
      return type;
    }
  }
  
  return undefined;
}

/**
 * Extracts potential name patterns from search query
 */
function extractNamePatterns(query: string): string[] {
  const patterns: string[] = [];
  
  // Look for quoted names
  const quotedMatches = query.match(/["']([^"']+)["']/g);
  if (quotedMatches) {
    quotedMatches.forEach(match => {
      const cleaned = match.replace(/["']/g, '').trim();
      if (cleaned.length > 0) {
        patterns.push(cleaned); // Keep original case for quoted names
      }
    });
  }
  
  // Look for specific name indicators
  const nameIndicators = [
    /(?:open|find|show|get|load)\s+(?:my\s+)?([a-zA-Z0-9\s]+?)(?:\s+(?:game|app|tool))?$/,
    /(?:the|my)\s+([a-zA-Z0-9\s]+?)(?:\s+(?:game|app|tool|I made|I created))/,
    /([a-zA-Z0-9\s]+?)\s+(?:game|app|tool)(?:\s+I\s+(?:made|created))?/
  ];
  
  for (const pattern of nameIndicators) {
    const match = query.match(pattern);
    if (match?.[1]) {
      const extracted = match[1].trim();
      if (extracted.length > 2) {
        patterns.push(extracted);
      }
    }
  }
  
  // If no specific patterns found, use the whole query as a potential name
  if (patterns.length === 0) {
    const cleanQuery = query
      .replace(/\b(?:open|find|show|get|load|the|my|last|recent)\b/g, '')
      .replace(/\b(?:game|app|tool|I made|I created)\b/g, '')
      .trim();
    
    if (cleanQuery.length > 2) {
      patterns.push(cleanQuery);
    }
  }
  
  return patterns;
}

/**
 * Extracts feature keywords from search query
 */
function extractFeatures(query: string): string[] {
  const features: string[] = [];
  
  const featurePatterns = [
    'multiplayer', 'single-player', 'solo', 'real-time', 'responsive',
    'mobile', 'desktop', 'api', 'data', 'storage', 'database',
    'interactive', 'animated', 'dynamic', 'static', 'simple', 'complex',
    'advanced', 'basic', 'professional', 'casual', 'educational'
  ];
  
  for (const feature of featurePatterns) {
    if (query.includes(feature) || query.includes(feature.replace('-', ' '))) {
      features.push(feature);
    }
  }
  
  return features;
}

/**
 * Extracts temporal indicators from search query
 */
function extractTemporalIndicators(query: string): string[] {
  const indicators: string[] = [];
  
  const temporalPatterns = [
    'last', 'recent', 'latest', 'newest', 'oldest', 'first',
    'yesterday', 'today', 'this week', 'last week', 'this month',
    'last month', 'ago'
  ];
  
  for (const pattern of temporalPatterns) {
    if (query.includes(pattern)) {
      indicators.push(pattern);
    }
  }
  
  return indicators;
}

/**
 * Determines the best search method based on query analysis
 */
function determineSearchMethod(
  query: string, 
  namePatterns: string[]
): 'semantic' | 'fuzzy' | 'exact' {
  // If query contains quoted text, prefer exact matching
  if (query.includes('"') || query.includes("'")) {
    return 'exact';
  }
  
  // If query is very short or contains obvious typos, use fuzzy
  if (query.length < 10 || containsLikelyTypos(query)) {
    return 'fuzzy';
  }
  
  // Default to semantic search for natural language queries
  return 'semantic';
}

/**
 * Builds search filters based on query analysis
 */
function buildSearchFilters(
  query: string,
  contentType?: HtmlContentType,
  temporalIndicators: string[] = []
): Record<string, any> {
  const filters: Record<string, any> = {};
  
  if (contentType) {
    filters.contentType = contentType;
  }
  
  // Temporal filters
  if (temporalIndicators.includes('last') || temporalIndicators.includes('recent')) {
    filters.orderBy = 'lastModified';
    filters.order = 'desc';
  }
  
  if (temporalIndicators.includes('first') || temporalIndicators.includes('oldest')) {
    filters.orderBy = 'createdAt';
    filters.order = 'asc';
  }
  
  return filters;
}

/**
 * Calculates relevance score between an applet and search query
 */
function calculateRelevance(
  applet: EnhancedHtmlContent,
  query: ParsedSearchQuery
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  
  // Exact name matches (highest weight)
  for (const pattern of query.namePatterns) {
    const exactScore = calculateExactMatch(applet.title, pattern);
    if (exactScore > 0.8) {
      score += exactScore * 2.0;
      reasons.push(`Exact title match: "${pattern}"`);
    }
  }
  
  // Fuzzy name matches
  for (const pattern of query.namePatterns) {
    const fuzzyScore = calculateFuzzyMatch(applet.title, pattern);
    if (fuzzyScore > 0.6) {
      score += fuzzyScore * 1.5;
      reasons.push(`Similar title: "${pattern}" → "${applet.title}"`);
    }
  }
  
  // Content type matches
  if (query.contentType && applet.contentType === query.contentType) {
    score += 1.0;
    reasons.push(`Content type match: ${query.contentType}`);
  }
  
  // Feature matches
  for (const feature of query.features) {
    if (applet.semanticTags?.includes(feature) || 
        applet.searchKeywords?.includes(feature)) {
      score += 0.5;
      reasons.push(`Feature match: ${feature}`);
    }
  }
  
  // Description semantic similarity
  const descriptionScore = calculateSemanticSimilarity(
    applet.userRequest || applet.title,
    query.normalizedQuery
  );
  if (descriptionScore > 0.3) {
    score += descriptionScore * 0.8;
    reasons.push(`Description similarity: ${Math.round(descriptionScore * 100)}%`);
  }
  
  // Keyword matches
  const keywordScore = calculateKeywordMatches(
    applet.searchKeywords || [],
    query.normalizedQuery
  );
  if (keywordScore > 0) {
    score += keywordScore * 0.6;
    reasons.push(`Keyword matches: ${Math.round(keywordScore * 100)}%`);
  }
  
  // Boost for recently accessed applets
  if (applet.lastAccessed) {
    const daysSinceAccess = (Date.now() - applet.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess < 7) {
      const recencyBoost = Math.max(0, (7 - daysSinceAccess) / 7) * 0.3;
      score += recencyBoost;
      reasons.push(`Recent access bonus: ${Math.round(recencyBoost * 100)}%`);
    }
  }
  
  return { score: Math.min(score, 5.0), reasons }; // Cap at 5.0
}

/**
 * Calculates exact match score between two strings
 */
function calculateExactMatch(text: string, pattern: string): number {
  const normalizedText = text.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  
  if (normalizedText === normalizedPattern) {
    return 1.0;
  }
  
  if (normalizedText.includes(normalizedPattern)) {
    return normalizedPattern.length / normalizedText.length;
  }
  
  return 0;
}

/**
 * Calculates fuzzy match score using Levenshtein distance
 */
function calculateFuzzyMatch(text: string, pattern: string): number {
  const normalizedText = text.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  
  const distance = levenshteinDistance(normalizedText, normalizedPattern);
  const maxLength = Math.max(normalizedText.length, normalizedPattern.length);
  
  return Math.max(0, (maxLength - distance) / maxLength);
}

/**
 * Calculates semantic similarity between two texts
 */
function calculateSemanticSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  const intersection = new Set([...words1].filter(word => words2.has(word)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Calculates keyword match score
 */
function calculateKeywordMatches(keywords: string[], query: string): number {
  if (keywords.length === 0) return 0;
  
  const queryWords = new Set(query.split(/\s+/).filter(w => w.length > 2));
  const matches = keywords.filter(keyword => queryWords.has(keyword));
  
  return matches.length / keywords.length;
}

/**
 * Calculates Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }
  
  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Checks if query contains likely typos
 */
function containsLikelyTypos(query: string): boolean {
  // Simple heuristics for detecting typos
  const words = query.split(/\s+/);
  
  for (const word of words) {
    // Check for repeated characters that might be typos
    if (/(.)\1{2,}/.test(word)) {
      return true;
    }
    
    // Check for common typo patterns
    if (word.includes('teh') || word.includes('adn') || word.includes('hte')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Generates search suggestions based on available applets
 */
export function generateSearchSuggestions(
  applets: EnhancedHtmlContent[],
  partialQuery: string = ''
): string[] {
  const suggestions: string[] = [];
  
  // Get most common applet names
  const nameFrequency = new Map<string, number>();
  applets.forEach(applet => {
    const words = applet.title.toLowerCase().split(/\s+/);
    words.forEach(word => {
      if (word.length > 2) {
        nameFrequency.set(word, (nameFrequency.get(word) || 0) + 1);
      }
    });
  });
  
  // Sort by frequency and add to suggestions
  const sortedWords = Array.from(nameFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
  
  suggestions.push(...sortedWords);
  
  // Add content type suggestions  
  suggestions.push('my games', 'my apps', 'my tools');
  
  // Add temporal suggestions
  suggestions.push('recent apps', 'last game');
  
  // Filter based on partial query if provided
  if (partialQuery) {
    const filtered = suggestions.filter(suggestion =>
      suggestion.toLowerCase().includes(partialQuery.toLowerCase())
    );
    return filtered.slice(0, 5);
  }
  
  return suggestions.slice(0, 8);
}
