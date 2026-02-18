/**
 * Pure helper to convert a natural language query into a Wikipedia article URL.
 * Extracted from original /api/search-wikipedia route for testability & feature encapsulation.
 */
export function generateWikipediaUrl(rawQuery: string): string {
  let cleanQuery = (rawQuery || '').trim();

  const questionPrefixes = [
    'what is ', 'who is ', 'who was ', 'tell me about ', 'search about ',
    'bring up an article on ', 'show me information about ', 'define ',
    'what are ', 'who are ', 'tell me more about ', 'search for ',
    'look up ', 'find information about ', 'give me info on '
  ];

  for (const prefix of questionPrefixes) {
    if (cleanQuery.toLowerCase().startsWith(prefix)) {
      cleanQuery = cleanQuery.substring(prefix.length);
      break;
    }
  }

  cleanQuery = cleanQuery.replace(/[?!.]+$/, '').trim();

  const specialCases: Record<string, string> = {
    'the great gatsby': 'The_Great_Gatsby',
    'american civil war': 'American_Civil_War',
    'seven wonders of the world': 'Seven_Wonders_of_the_Ancient_World',
    'mahatma gandhi': 'Mahatma_Gandhi',
    'albert einstein': 'Albert_Einstein',
    'quantum physics': 'Quantum_mechanics',
    'prompt engineering': 'Prompt_engineering',
    'artificial intelligence': 'Artificial_intelligence',
    'machine learning': 'Machine_learning',
    'deep learning': 'Deep_learning',
    'world war 2': 'World_War_II',
    'world war ii': 'World_War_II',
    'world war 1': 'World_War_I',
    'world war i': 'World_War_I'
  };

  const lower = cleanQuery.toLowerCase();
  if (specialCases[lower]) {
    return `https://en.wikipedia.org/wiki/${specialCases[lower]}`;
  }

  const formatted = cleanQuery
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('_');

  return `https://en.wikipedia.org/wiki/${encodeURIComponent(formatted)}`;
}

export interface WikipediaSearchResponse {
  success: boolean;
  action: string;
  query: string;
  userRequest: string;
  wikipediaUrl: string;
  message: string;
  payload: {
    app: string;
    url: string;
    searchReason: string;
  };
  timestamp: string;
}
