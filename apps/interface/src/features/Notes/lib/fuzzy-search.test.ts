/**
 * Unit tests for fuzzy search functionality
 * Tests text normalization, matching algorithms, and search capabilities
 */

import {
  normalizeText,
  extractWords,
  levenshteinDistance,
  calculateSimilarity,
  fuzzyMatch,
  fuzzySearch,
} from './fuzzy-search';

describe('normalizeText', () => {
  it('should convert to lowercase', () => {
    expect(normalizeText('HELLO WORLD')).toBe('hello world');
    expect(normalizeText('TeSt')).toBe('test');
  });

  it('should convert numbers to words', () => {
    expect(normalizeText('Testing 2')).toContain('two');
    expect(normalizeText('1 item')).toContain('one');
    expect(normalizeText('Project 5')).toContain('five');
  });

  it('should remove special characters', () => {
    expect(normalizeText('hello_world')).toBe('hello world');
    expect(normalizeText('test-file')).toBe('test file');
    expect(normalizeText('note#1')).toContain('note');
  });

  it('should normalize whitespace', () => {
    expect(normalizeText('hello   world')).toBe('hello world');
    expect(normalizeText('  test  ')).toBe('test');
  });

  it('should handle speech-to-text variations', () => {
    const techNormalized = normalizeText('tech');
    const textNormalized = normalizeText('text');
    
    // Both should include bidirectional variations
    expect(techNormalized).toContain('tech');
    expect(techNormalized).toContain('text');
    expect(textNormalized).toContain('tech');
    expect(textNormalized).toContain('text');
  });

  it('should handle empty strings', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   ')).toBe('');
  });
});

describe('extractWords', () => {
  it('should extract individual words', () => {
    expect(extractWords('hello world')).toEqual(['hello', 'world']);
    expect(extractWords('Shopping List')).toEqual(['shopping', 'list']);
  });

  it('should handle special characters', () => {
    expect(extractWords('hello_world')).toEqual(['hello', 'world']);
    expect(extractWords('test-file')).toEqual(['test', 'file']);
  });

  it('should filter empty strings', () => {
    expect(extractWords('hello  world')).toEqual(['hello', 'world']);
    expect(extractWords('   test   ')).toEqual(['test']);
  });

  it('should handle numbers', () => {
    const words = extractWords('Testing 2');
    expect(words).toContain('testing');
    expect(words).toContain('two');
  });
});

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
    expect(levenshteinDistance('test', 'test')).toBe(0);
  });

  it('should calculate insertion distance', () => {
    expect(levenshteinDistance('hello', 'helo')).toBe(1);
    expect(levenshteinDistance('test', 'tst')).toBe(1);
  });

  it('should calculate deletion distance', () => {
    expect(levenshteinDistance('hello', 'helllo')).toBe(1);
    expect(levenshteinDistance('test', 'tesst')).toBe(1);
  });

  it('should calculate substitution distance', () => {
    expect(levenshteinDistance('hello', 'hallo')).toBe(1);
    expect(levenshteinDistance('test', 'best')).toBe(1);
  });

  it('should handle complex edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
  });

  it('should handle empty strings', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
    expect(levenshteinDistance('hello', '')).toBe(5);
    expect(levenshteinDistance('', '')).toBe(0);
  });
});

describe('calculateSimilarity', () => {
  it('should return 1 for identical strings', () => {
    expect(calculateSimilarity('hello', 'hello')).toBe(1);
    expect(calculateSimilarity('test', 'test')).toBe(1);
  });

  it('should return 0 for empty strings', () => {
    expect(calculateSimilarity('', 'hello')).toBe(0);
    expect(calculateSimilarity('hello', '')).toBe(0);
  });

  it('should calculate similarity for similar strings', () => {
    const similarity = calculateSimilarity('hello', 'helo');
    expect(similarity).toBeGreaterThan(0.8);
    expect(similarity).toBeLessThan(1);
  });

  it('should calculate similarity for different strings', () => {
    const similarity = calculateSimilarity('hello', 'world');
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(0.5);
  });

  it('should handle typos', () => {
    expect(calculateSimilarity('shopping', 'shoping')).toBeGreaterThan(0.8);
    expect(calculateSimilarity('testing', 'testig')).toBeGreaterThan(0.8);
  });
});

describe('fuzzyMatch', () => {
  describe('exact matches', () => {
    it('should match identical strings', () => {
      const result = fuzzyMatch('hello', 'hello');
      expect(result.matches).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.matchType).toBe('exact');
    });

    it('should match case-insensitively', () => {
      const result = fuzzyMatch('Shopping List', 'shopping list');
      expect(result.matches).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.matchType).toBe('exact');
    });

    it('should match with special characters normalized', () => {
      const result = fuzzyMatch('test_file', 'test-file');
      expect(result.matches).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.matchType).toBe('exact');
    });
  });

  describe('substring matches', () => {
    it('should match substrings', () => {
      const result = fuzzyMatch('shop', 'shopping list');
      expect(result.matches).toBe(true);
      expect(result.score).toBe(0.9);
      expect(result.matchType).toBe('substring');
    });

    it('should match partial words', () => {
      const result = fuzzyMatch('list', 'shopping list');
      expect(result.matches).toBe(true);
      expect(result.score).toBe(0.9);
      expect(result.matchType).toBe('substring');
    });
  });

  describe('word-based matches', () => {
    it('should match word order independently', () => {
      const result = fuzzyMatch('list shopping', 'shopping list');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
      expect(result.matchType).toBe('word-based');
    });

    it('should match with partial word overlap', () => {
      const result = fuzzyMatch('shopping list', 'shopping list notes');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
    });

    it('should handle numbers as words', () => {
      const result = fuzzyMatch('testing two', 'Testing 2');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
      expect(result.matchType).toBe('word-based');
    });

    it('should match with typos in words', () => {
      const result = fuzzyMatch('shoping list', 'shopping list');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('fuzzy string similarity matches', () => {
    it('should match strings with typos', () => {
      const result = fuzzyMatch('shoping', 'shopping');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.5);
      expect(result.matchType).toBe('fuzzy');
    });

    it('should match similar strings', () => {
      const result = fuzzyMatch('teting', 'testing');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('partial matches', () => {
    it('should match single character prefixes', () => {
      const result = fuzzyMatch('sh', 'shopping');
      expect(result.matches).toBe(true);
      expect(result.score).toBe(0.4);
      expect(result.matchType).toBe('partial');
    });

    it('should match partial single words', () => {
      const result = fuzzyMatch('test', 'testing project');
      expect(result.matches).toBe(true);
      expect(result.matchType).toBe('partial');
    });
  });

  describe('speech-to-text variations', () => {
    it('should match tech/text variations', () => {
      const result = fuzzyMatch('tech', 'text file');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
    });

    it('should match text/tech variations', () => {
      const result = fuzzyMatch('text', 'tech notes');
      expect(result.matches).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('non-matches', () => {
    it('should not match completely different strings', () => {
      const result = fuzzyMatch('xyz', 'abc');
      expect(result.matches).toBe(false);
      expect(result.score).toBe(0);
      expect(result.matchType).toBe('none');
    });

    it('should not match with low similarity', () => {
      const result = fuzzyMatch('hello', 'world');
      expect(result.matches).toBe(false);
    });

    it('should handle empty search strings', () => {
      const result = fuzzyMatch('', 'shopping list');
      expect(result.matches).toBe(false);
      expect(result.score).toBe(0);
    });

    it('should handle empty target strings', () => {
      const result = fuzzyMatch('shopping', '');
      expect(result.matches).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle single character searches', () => {
      const result = fuzzyMatch('a', 'abc');
      expect(result.matches).toBe(true);
      expect(result.matchType).toBe('partial');
    });

    it('should handle unicode characters', () => {
      const result = fuzzyMatch('café', 'café notes');
      expect(result.matches).toBe(true);
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      const result = fuzzyMatch(longString, longString);
      expect(result.matches).toBe(true);
      expect(result.score).toBe(1.0);
    });
  });
});

describe('fuzzySearch', () => {
  interface TestNote {
    title: string;
    id: number;
  }

  const testNotes: TestNote[] = [
    { title: 'Shopping List', id: 1 },
    { title: 'Work Notes', id: 2 },
    { title: 'Project Planning', id: 3 },
    { title: 'Meeting Notes', id: 4 },
    { title: 'Testing 2', id: 5 },
    { title: 'Tech Documentation', id: 6 },
    { title: 'Daily Tasks', id: 7 },
    { title: 'Grocery List', id: 8 },
    { title: 'Sprint Planning', id: 9 },
    { title: 'Ideas_2024', id: 10 },
  ];

  describe('basic search', () => {
    it('should find exact matches', () => {
      const results = fuzzySearch(testNotes, 'Shopping List', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
      expect(results[0].score).toBe(1.0);
    });

    it('should find case-insensitive matches', () => {
      const results = fuzzySearch(testNotes, 'shopping list', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
    });

    it('should find partial matches', () => {
      const results = fuzzySearch(testNotes, 'shop', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
    });
  });

  describe('fuzzy matching', () => {
    it('should find matches with typos', () => {
      const results = fuzzySearch(testNotes, 'shoping list', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
    });

    it('should handle word order variations', () => {
      const results = fuzzySearch(testNotes, 'list shopping', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
    });

    it('should handle numbers as words', () => {
      const results = fuzzySearch(testNotes, 'testing two', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Testing 2');
    });

    it('should handle speech-to-text variations', () => {
      const results = fuzzySearch(testNotes, 'text documentation', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      // Should match Tech Documentation due to tech/text variation
      const hasTechDoc = results.some(r => r.item.title === 'Tech Documentation');
      expect(hasTechDoc).toBe(true);
    });

    it('should handle special characters', () => {
      const results = fuzzySearch(testNotes, 'ideas 2024', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Ideas_2024');
    });
  });

  describe('multiple matches', () => {
    it('should find multiple matching notes', () => {
      const results = fuzzySearch(testNotes, 'list', (note) => note.title);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const titles = results.map(r => r.item.title);
      expect(titles).toContain('Shopping List');
      expect(titles).toContain('Grocery List');
    });

    it('should find all notes containing a word', () => {
      const results = fuzzySearch(testNotes, 'notes', (note) => note.title);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const titles = results.map(r => r.item.title);
      expect(titles).toContain('Work Notes');
      expect(titles).toContain('Meeting Notes');
    });

    it('should find all planning-related notes', () => {
      const results = fuzzySearch(testNotes, 'planning', (note) => note.title);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const titles = results.map(r => r.item.title);
      expect(titles).toContain('Project Planning');
      expect(titles).toContain('Sprint Planning');
    });
  });

  describe('sorting and scoring', () => {
    it('should sort by score (highest first)', () => {
      const results = fuzzySearch(
        testNotes,
        'shopping',
        (note) => note.title,
        { sortByScore: true }
      );
      expect(results.length).toBeGreaterThan(0);
      // Scores should be in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should prefer exact matches over partial matches', () => {
      const results = fuzzySearch(testNotes, 'work', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      // Work Notes should score higher than other matches
      const workNotes = results.find(r => r.item.title === 'Work Notes');
      expect(workNotes).toBeDefined();
      expect(workNotes!.score).toBeGreaterThan(0.7);
    });
  });

  describe('options', () => {
    it('should respect minScore threshold', () => {
      const results = fuzzySearch(
        testNotes,
        'xyz',
        (note) => note.title,
        { minScore: 0.8 }
      );
      expect(results).toHaveLength(0);
    });

    it('should limit maxResults', () => {
      const results = fuzzySearch(
        testNotes,
        'list',
        (note) => note.title,
        { maxResults: 1 }
      );
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should handle custom minScore', () => {
      const results = fuzzySearch(
        testNotes,
        'shop',
        (note) => note.title,
        { minScore: 0.5 }
      );
      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.score).toBeGreaterThanOrEqual(0.5);
      });
    });

    it('should disable sorting when requested', () => {
      const results = fuzzySearch(
        testNotes,
        'notes',
        (note) => note.title,
        { sortByScore: false }
      );
      expect(results.length).toBeGreaterThan(0);
      // Results might not be sorted by score
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty search', () => {
      const results = fuzzySearch(testNotes, '', (note) => note.title);
      expect(results).toEqual([]);
    });

    it('should return empty array for whitespace search', () => {
      const results = fuzzySearch(testNotes, '   ', (note) => note.title);
      expect(results).toEqual([]);
    });

    it('should handle empty items array', () => {
      const results = fuzzySearch<TestNote>([], 'test', (note) => note.title);
      expect(results).toEqual([]);
    });

    it('should handle items with empty titles', () => {
      const notesWithEmpty = [...testNotes, { title: '', id: 99 }];
      const results = fuzzySearch(notesWithEmpty, 'shopping', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
    });
  });

  describe('real-world scenarios', () => {
    it('should find "grocery list" when searching "grocery"', () => {
      const results = fuzzySearch(testNotes, 'grocery', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Grocery List');
    });

    it('should find notes with misspelled search terms', () => {
      const results = fuzzySearch(testNotes, 'meetng', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      const hasMeetingNotes = results.some(r => r.item.title === 'Meeting Notes');
      expect(hasMeetingNotes).toBe(true);
    });

    it('should handle search with extra spaces', () => {
      const results = fuzzySearch(testNotes, '  shopping  list  ', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
    });

    it('should find tasks when searching for "daily"', () => {
      const results = fuzzySearch(testNotes, 'daily', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Daily Tasks');
    });

    it('should distinguish between different "list" notes', () => {
      const results = fuzzySearch(testNotes, 'shopping list', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toBe('Shopping List');
      // Should score higher than Grocery List
      const shoppingIndex = results.findIndex(r => r.item.title === 'Shopping List');
      const groceryIndex = results.findIndex(r => r.item.title === 'Grocery List');
      if (groceryIndex !== -1) {
        expect(shoppingIndex).toBeLessThan(groceryIndex);
      }
    });
  });

  describe('matched words', () => {
    it('should return matched words for word-based matches', () => {
      const results = fuzzySearch(testNotes, 'shopping list', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matches.length).toBeGreaterThan(0);
    });

    it('should return matched words for partial matches', () => {
      const results = fuzzySearch(testNotes, 'shop', (note) => note.title);
      expect(results.length).toBeGreaterThan(0);
      const shoppingResult = results.find(r => r.item.title === 'Shopping List');
      if (shoppingResult) {
        expect(shoppingResult.matches.length).toBeGreaterThan(0);
      }
    });
  });
});
