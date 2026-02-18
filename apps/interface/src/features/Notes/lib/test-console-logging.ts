/**
 * Structured logging demonstration for Notes search flows.
 * Simulates the log output you'd see (tagged `Notes`) during searches.
 */

import { fuzzySearch, debugFuzzyMatch, fuzzyMatch, normalizeText } from './fuzzy-search';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('Notes');

// Sample notes for testing
const testNotes = [
  { _id: '1', title: 'Shopping List', mode: 'personal' as const },
  { _id: '2', title: 'Testing 2 Features', mode: 'personal' as const },
  { _id: '3', title: 'Testing Two Methods', mode: 'personal' as const },
  { _id: '4', title: 'Tech Documentation', mode: 'work' as const },
  { _id: '5', title: 'Text Processing Guide', mode: 'work' as const },
  { _id: '6', title: 'Daily_Tasks_2024', mode: 'personal' as const },
  { _id: '7', title: 'Project-Alpha Ideas', mode: 'work' as const },
  { _id: '8', title: 'Meeting Notes', mode: 'work' as const }
];

/**
 * Simulate the voice command search logging
 */
function simulateVoiceCommandSearch(searchQuery: string, targetMode: 'personal' | 'work') {
  log.info('Simulating voice command search', { searchQuery, targetMode });
  
  // Filter by mode first (like the real code)
  const notesInMode = testNotes.filter(n => n.mode === targetMode);
  log.info('Starting fuzzy search by mode', {
    searchQuery,
    targetMode,
    availableNotes: notesInMode.map(n => n.title)
  });
  
  const fuzzyResults = fuzzySearch(
    notesInMode,
    searchQuery,
    (note) => note.title || '',
    {
      minScore: 0.3,
      maxResults: 20,
      sortByScore: true
    }
  );
  
  log.info('Fuzzy search results summary', {
    searchQuery,
    targetMode,
    searchedCount: notesInMode.length,
    resultCount: fuzzyResults.length
  });
  
  if (fuzzyResults.length > 0) {
    log.info('Found matching notes', {
      searchQuery,
      targetMode,
      matches: fuzzyResults.map((result, index) => ({
        position: index + 1,
        title: result.item.title,
        score: result.score,
        matches: result.matches
      }))
    });
    
    log.info('Debug info for top match', {
      searchQuery,
      topTitle: fuzzyResults[0].item.title
    });
    debugFuzzyMatch(searchQuery, fuzzyResults[0].item.title || '');
    
    log.info('Final search results list', {
      searchQuery,
      targetMode,
      finalOrder: fuzzyResults.map((result, index) => ({
        position: index + 1,
        title: result.item.title,
        primary: index === 0
      }))
    });
  } else {
    log.warn('No matches found for voice command search', {
      searchQuery,
      normalizedQuery: normalizeText(searchQuery),
      targetMode,
      availableTitles: notesInMode.map(note => ({
        title: note.title,
        normalized: normalizeText(note.title || '')
      })),
      matchAnalysis: notesInMode.map(note => {
        const matchResult = fuzzyMatch(searchQuery, note.title || '');
        return {
          title: note.title,
          score: matchResult.score,
          matchType: matchResult.matchType,
          matches: matchResult.matches
        };
      })
    });
  }
}

/**
 * Simulate UI search bar logging
 */
function simulateUISearch(searchQuery: string) {
  log.info('Simulating UI search bar', {
    searchQuery,
    totalNotes: testNotes.length
  });
  
  const fuzzyResults = fuzzySearch(
    testNotes,
    searchQuery,
    (note) => note.title || '',
    {
      minScore: 0.2,
      maxResults: 50,
      sortByScore: true
    }
  );
  
  if (fuzzyResults.length > 0) {
    log.info('UI search matches', {
      searchQuery,
      resultCount: fuzzyResults.length,
      matches: fuzzyResults.map((result, index) => ({
        position: index + 1,
        title: result.item.title,
        score: result.score
      }))
    });
  } else {
    log.warn('UI search found no matches', {
      searchQuery,
      availableTitles: testNotes.map(n => n.title)
    });
  }
}

/**
 * Run all test scenarios
 */
export function runStructuredLoggingDemo() {
  log.info('Structured logging demonstration start');
  
  // Test cases that should work well
  log.info('Successful search scenarios');
  simulateVoiceCommandSearch('testing two', 'personal'); // Should find "Testing 2 Features"
  simulateVoiceCommandSearch('tech', 'work'); // Should find "Tech Documentation"
  simulateUISearch('daily tasks'); // Should find "Daily_Tasks_2024"
  
  // Test cases that should show no results
  log.info('No results scenarios');
  simulateVoiceCommandSearch('nonexistent note', 'personal'); // Should show detailed analysis
  simulateUISearch('xyz123'); // Should show available titles
  
  log.info('Structured logging demonstration complete', {
    scenariosRun: 5
  });
}

// Run if executed directly
if (require.main === module) {
  runStructuredLoggingDemo();
}
