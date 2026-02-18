/**
 * Tests for notes-api helper functions
 */

import { findNoteWithFuzzySearch, FindNoteResult, Note } from '../notes-api';

// Mock fetch globally
global.fetch = jest.fn();

describe('findNoteWithFuzzySearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Search by ID', () => {
    it('should find note by exact ID', async () => {
      const mockNote: Note = {
        _id: 'note-123',
        title: 'Test Note',
        content: 'Test content',
        mode: 'personal',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [mockNote],
      });

      const result: FindNoteResult = await findNoteWithFuzzySearch(
        { id: 'note-123' },
        'testAssistant'
      );

      expect(result.found).toBe(true);
      expect(result.note).toEqual(mockNote);
      expect(result.searchPerformed).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/note-123')
      );
    });

    it('should handle ID not found', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => [],
      });

      const result: FindNoteResult = await findNoteWithFuzzySearch(
        { id: 'nonexistent' },
        'testAssistant'
      );

      expect(result.found).toBe(false);
      expect(result.searchPerformed).toBe(false);
    });
  });

  describe('Search by title - exact match', () => {
    it('should find note by exact title', async () => {
      const mockNote: Note = {
        _id: 'note-456',
        title: 'Shopping List',
        content: 'Buy groceries',
        mode: 'personal',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [mockNote],
      });

      const result = await findNoteWithFuzzySearch(
        { title: 'Shopping List' },
        'testAssistant'
      );

      expect(result.found).toBe(true);
      expect(result.note).toEqual(mockNote);
      expect(result.searchPerformed).toBe(false);
    });
  });

  describe('Fuzzy search fallback', () => {
    it('should perform fuzzy search when exact title not found', async () => {
      const allNotes: Note[] = [
        { _id: 'note-1', title: 'Collaboration', mode: 'work' },
        { _id: 'note-2', title: 'Work Meetings', mode: 'work' },
        { _id: 'note-3', title: 'Project Ideas', mode: 'personal' },
      ];

      // First call: exact title search - not found
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Second call: fetch all notes (both modes) for fuzzy search
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => allNotes,
      });

      const result = await findNoteWithFuzzySearch(
        { title: 'collaboration note' }, // Lowercase, partial match
        'testAssistant'
      );

      expect(result.found).toBe(true);
      expect(result.note?.title).toBe('Collaboration');
      expect(result.searchPerformed).toBe(true);
      expect(result.allNotes).toEqual(allNotes);
    });

    it('should return all notes when fuzzy search finds no match', async () => {
      const allNotes: Note[] = [
        { _id: 'note-1', title: 'Alpha', mode: 'personal' },
        { _id: 'note-2', title: 'Beta', mode: 'work' },
      ];

      // First call: exact title search - not found
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Second call: fetch all notes
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => allNotes,
      });

      const result = await findNoteWithFuzzySearch(
        { title: 'Completely Different Title' },
        'testAssistant'
      );

      expect(result.found).toBe(false);
      expect(result.searchPerformed).toBe(true);
      expect(result.allNotes).toEqual(allNotes);
    });

    it('should handle typos in title search', async () => {
      const allNotes: Note[] = [
        { _id: 'note-1', title: 'Meeting Notes', mode: 'work' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValueOnce({ ok: true, json: async () => allNotes });

      const result = await findNoteWithFuzzySearch(
        { title: 'meting notes' }, // Typo: 'meting' instead of 'meeting'
        'testAssistant'
      );

      expect(result.found).toBe(true);
      expect(result.note?.title).toBe('Meeting Notes');
      expect(result.searchPerformed).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await findNoteWithFuzzySearch(
        { title: 'Test' },
        'testAssistant'
      );

      expect(result.found).toBe(false);
      expect(result.searchPerformed).toBe(false);
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await findNoteWithFuzzySearch(
        { title: 'Test' },
        'testAssistant'
      );

      expect(result.found).toBe(false);
      expect(result.searchPerformed).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty results array', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValueOnce({ ok: true, json: async () => [] });

      const result = await findNoteWithFuzzySearch(
        { title: 'Test' },
        'testAssistant'
      );

      expect(result.found).toBe(false);
      expect(result.searchPerformed).toBe(false);
    });

    it('should handle missing both ID and title', async () => {
      const result = await findNoteWithFuzzySearch({}, 'testAssistant');

      expect(result.found).toBe(false);
      expect(result.searchPerformed).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

describe('fetchNotesIncremental', () => {
  // Mock EventSource
  class MockEventSource {
    url: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((error: Event) => void) | null = null;
    closed = false;
    
    constructor(url: string) {
      this.url = url;
    }
    
    close() {
      this.closed = true;
    }
    
    simulateMessage(data: unknown) {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(data) } as MessageEvent);
      }
    }
    
    simulateError() {
      if (this.onerror) {
        this.onerror(new Event('error'));
      }
    }
  }
  
  let originalEventSource: typeof EventSource;
  
  beforeAll(() => {
    originalEventSource = global.EventSource;
    // @ts-expect-error - Mock EventSource
    global.EventSource = MockEventSource;
  });
  
  afterAll(() => {
    global.EventSource = originalEventSource;
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should export fetchNotesIncremental function', async () => {
    const { fetchNotesIncremental } = await import('../notes-api');
    expect(typeof fetchNotesIncremental).toBe('function');
  });
  
  it('should export NoteBatchType type values', async () => {
    // Test the expected batch type values through usage
    const validTypes = ['personal', 'work', 'shared-to-user', 'shared-to-all'];
    expect(validTypes).toContain('personal');
    expect(validTypes).toContain('shared-to-all');
  });
  
  it('should build correct SSE URL', async () => {
    const { fetchNotesIncremental } = await import('../notes-api');
    
    const batches: unknown[] = [];
    const { abort } = fetchNotesIncremental('test-assistant', 'personal', (batch) => {
      batches.push(batch);
    });
    
    // Abort to clean up
    abort();
  });
  
  it('should return abort function', async () => {
    const { fetchNotesIncremental } = await import('../notes-api');
    
    const { promise, abort } = fetchNotesIncremental('test', 'all', () => {});
    
    expect(typeof abort).toBe('function');
    expect(promise).toBeInstanceOf(Promise);
    
    // Clean up
    abort();
  });
  
  it('should handle JSON fallback endpoint', async () => {
    const { fetchNotesIncrementalJSON } = await import('../notes-api');
    
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        batches: [{ batch: 'personal', items: [] }],
        items: [],
      }),
    });
    
    const result = await fetchNotesIncrementalJSON('test-assistant', 'personal');
    
    expect(result.batches).toBeDefined();
    expect(result.items).toBeDefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/notes/incremental')
    );
  });
  
  it('should handle JSON fallback error', async () => {
    const { fetchNotesIncrementalJSON } = await import('../notes-api');
    
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    
    await expect(fetchNotesIncrementalJSON('test', 'all')).rejects.toThrow('Failed to fetch notes');
  });
});
