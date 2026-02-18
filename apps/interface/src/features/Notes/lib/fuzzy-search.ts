/**
 * Fuzzy search utilities for note title matching
 * Handles typos, numbers, symbols, and word-based matching
 */
import { getClientLogger } from '@interface/lib/client-logger';

export interface FuzzySearchResult {
  item: any;
  score: number;
  matches: string[];
}

/**
 * Normalize text for comparison by:
 * - Converting to lowercase
 * - Removing special characters and symbols
 * - Converting numbers to words
 * - Handling common speech-to-text variations
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  
  let normalized = text.toLowerCase().trim();
  
  // Convert numbers to words for better speech-to-text matching
  const numberMap: Record<string, string> = {
    '1': 'one',
    '2': 'two', 
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
    '0': 'zero'
  };
  
  // Replace standalone numbers with words
  normalized = normalized.replace(/\b\d\b/g, (match) => numberMap[match] || match);
  
  // Handle common speech-to-text variations
  const speechVariations: Record<string, string> = {
    'tech': 'text',
    'text': 'tech',
    'testing': 'test',
    'test': 'testing'
  };
  
  // Apply speech variations (bidirectional)
  Object.entries(speechVariations).forEach(([from, to]) => {
    const regex = new RegExp(`\\b${from}\\b`, 'g');
    if (normalized.includes(from)) {
      normalized = normalized + ' ' + normalized.replace(regex, to);
    }
  });
  
  // Remove special characters but keep spaces
  normalized = normalized.replace(/[^\w\s]/g, ' ');
  
  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Extract words from normalized text
 */
export function extractWords(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized.split(/\s+/).filter(word => word.length > 0);
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Calculate similarity score between two strings (0-1, higher is better)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1;
  
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLength;
}

/**
 * Check if search terms match target text using various strategies
 */
export function fuzzyMatch(searchText: string, targetText: string): {
  matches: boolean;
  score: number;
  matchType: string;
  matchedWords: string[];
} {
  if (!searchText || !targetText) {
    return { matches: false, score: 0, matchType: 'none', matchedWords: [] };
  }
  
  const normalizedSearch = normalizeText(searchText);
  const normalizedTarget = normalizeText(targetText);
  const searchWords = extractWords(normalizedSearch);
  const targetWords = extractWords(normalizedTarget);
  
  // Strategy 1: Exact match (highest score)
  if (normalizedSearch === normalizedTarget) {
    return { matches: true, score: 1.0, matchType: 'exact', matchedWords: targetWords };
  }
  
  // Strategy 2: Exact substring match
  if (normalizedTarget.includes(normalizedSearch)) {
    return { matches: true, score: 0.9, matchType: 'substring', matchedWords: searchWords };
  }
  
  // Strategy 3: All words match (order independent)
  const matchedWords: string[] = [];
  let wordMatchScore = 0;
  
  for (const searchWord of searchWords) {
    let bestWordMatch = 0;
    let bestMatchedWord = '';
    
    for (const targetWord of targetWords) {
      // Exact word match
      if (searchWord === targetWord) {
        bestWordMatch = 1.0;
        bestMatchedWord = targetWord;
        break;
      }
      
      // Fuzzy word match
      const similarity = calculateSimilarity(searchWord, targetWord);
      if (similarity > bestWordMatch && similarity >= 0.7) { // 70% similarity threshold
        bestWordMatch = similarity;
        bestMatchedWord = targetWord;
      }
      
      // Partial word match (for longer words)
      if (searchWord.length >= 3 && targetWord.includes(searchWord)) {
        const partialScore = 0.8 * (searchWord.length / targetWord.length);
        if (partialScore > bestWordMatch) {
          bestWordMatch = partialScore;
          bestMatchedWord = targetWord;
        }
      }
    }
    
    if (bestWordMatch > 0) {
      wordMatchScore += bestWordMatch;
      matchedWords.push(bestMatchedWord);
    }
  }
  
  // Calculate overall word match score
  const wordMatchRatio = matchedWords.length / searchWords.length;
  const avgWordScore = wordMatchScore / searchWords.length;
  
  if (wordMatchRatio >= 0.5 && avgWordScore >= 0.7) { // At least 50% of words match with 70% accuracy
    return { 
      matches: true, 
      score: 0.7 + (wordMatchRatio * avgWordScore * 0.2), // Score between 0.7-0.9
      matchType: 'word-based',
      matchedWords
    };
  }
  
  // Strategy 4: Fuzzy string similarity
  const overallSimilarity = calculateSimilarity(normalizedSearch, normalizedTarget);
  if (overallSimilarity >= 0.6) { // 60% similarity threshold
    return { 
      matches: true, 
      score: 0.5 + (overallSimilarity * 0.2), // Score between 0.5-0.7
      matchType: 'fuzzy',
      matchedWords: []
    };
  }
  
  // Strategy 5: Partial matches for very short queries
  if (searchWords.length === 1 && searchWords[0].length >= 2) {
    for (const targetWord of targetWords) {
      if (targetWord.startsWith(searchWords[0]) || targetWord.includes(searchWords[0])) {
        return { 
          matches: true, 
          score: 0.4, 
          matchType: 'partial',
          matchedWords: [targetWord]
        };
      }
    }
  }
  
  return { matches: false, score: 0, matchType: 'none', matchedWords: [] };
}

/**
 * Perform fuzzy search on a list of items
 */
export function fuzzySearch<T>(
  items: T[],
  searchText: string,
  getSearchableText: (item: T) => string,
  options: {
    minScore?: number;
    maxResults?: number;
    sortByScore?: boolean;
  } = {}
): FuzzySearchResult[] {
  const { minScore = 0.3, maxResults = 50, sortByScore = true } = options;
  
  if (!searchText.trim()) return [];
  
  const results: FuzzySearchResult[] = [];
  
  for (const item of items) {
    const targetText = getSearchableText(item);
    const matchResult = fuzzyMatch(searchText, targetText);
    
    if (matchResult.matches && matchResult.score >= minScore) {
      results.push({
        item,
        score: matchResult.score,
        matches: matchResult.matchedWords
      });
    }
  }
  
  // Sort by score (highest first) if requested
  if (sortByScore) {
    results.sort((a, b) => b.score - a.score);
  }
  
  // Limit results if specified
  if (maxResults > 0) {
    return results.slice(0, maxResults);
  }
  
  return results;
}

/**
 * Debug function to show how search terms match
 */
export function debugFuzzyMatch(searchText: string, targetText: string): void {
  const log = getClientLogger('Notes');
  log.debug('Fuzzy search debug', {
    search: searchText,
    target: targetText,
    normalizedSearch: normalizeText(searchText),
    normalizedTarget: normalizeText(targetText),
    searchWords: extractWords(searchText),
    targetWords: extractWords(targetText),
    result: fuzzyMatch(searchText, targetText),
  });
}
