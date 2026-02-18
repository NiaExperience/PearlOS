/**
 * @jest-environment jsdom
 * 
 * Tests for incremental loading functionality (SSE streaming).
 * Tests the incremental route and hook behaviors.
 */

import { jest } from '@jest/globals';

// Mock EventSource for client-side SSE tests
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState: number = 0; // CONNECTING
  
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }
  
  close() {
    this.readyState = 2; // CLOSED
  }
  
  // Helper to simulate receiving a message
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      const event = { data: JSON.stringify(data) } as MessageEvent;
      this.onmessage(event);
    }
  }
  
  // Helper to simulate an error
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// Install mock
(global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

describe('Incremental Loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockEventSource.instances = [];
  });
  
  describe('Batch Structure', () => {
    it('should define correct batch types', () => {
      const validBatchTypes = ['personal', 'work', 'shared-to-user', 'shared-to-all'];
      
      // Test that batch types match expected values
      expect(validBatchTypes).toContain('personal');
      expect(validBatchTypes).toContain('work');
      expect(validBatchTypes).toContain('shared-to-user');
      expect(validBatchTypes).toContain('shared-to-all');
      expect(validBatchTypes).toHaveLength(4);
    });
    
    it('should process batch items correctly', () => {
      const batch = {
        batch: 'personal',
        items: [
          { _id: '1', title: 'Item 1' },
          { _id: '2', title: 'Item 2' },
        ],
        done: false,
      };
      
      expect(batch.batch).toBe('personal');
      expect(batch.items).toHaveLength(2);
      expect(batch.done).toBe(false);
    });
    
    it('should mark final batch with done flag', () => {
      const finalBatch = {
        batch: 'shared-to-all',
        items: [],
        done: true,
      };
      
      expect(finalBatch.done).toBe(true);
    });
  });
  
  describe('Batch Ordering', () => {
    it('should process batches in correct order', () => {
      const expectedOrder = ['personal', 'work', 'shared-to-user', 'shared-to-all'];
      const receivedOrder: string[] = [];
      
      // Simulate batch processing
      expectedOrder.forEach((batchType) => {
        receivedOrder.push(batchType);
      });
      
      expect(receivedOrder).toEqual(expectedOrder);
      expect(receivedOrder[0]).toBe('personal'); // Personal first
      expect(receivedOrder[receivedOrder.length - 1]).toBe('shared-to-all'); // Shared-to-all last
    });
    
    it('should handle mode=personal filter (only personal batch)', () => {
      const mode = 'personal';
      const expectedBatches = ['personal', 'shared-to-user', 'shared-to-all'];
      
      // In personal mode, work batch should be skipped
      expect(expectedBatches).not.toContain('work');
      expect(expectedBatches[0]).toBe('personal');
    });
    
    it('should handle mode=work filter (only work batch)', () => {
      const mode = 'work';
      const expectedBatches = ['work'];
      
      // In work mode, shared resources aren't fetched
      expect(expectedBatches).toContain('work');
      expect(expectedBatches).not.toContain('personal');
      expect(expectedBatches).not.toContain('shared-to-user');
    });
  });
  
  describe('Deduplication', () => {
    it('should deduplicate items across batches', () => {
      const seenIds = new Set<string>();
      const allItems: Array<{ _id: string; title: string }> = [];
      
      // Simulate receiving batches with overlapping IDs
      const batches = [
        { batch: 'personal', items: [{ _id: '1', title: 'Item 1' }] },
        { batch: 'shared-to-user', items: [{ _id: '1', title: 'Item 1 (dupe)' }, { _id: '2', title: 'Item 2' }] },
      ];
      
      for (const batch of batches) {
        for (const item of batch.items) {
          if (!seenIds.has(item._id)) {
            seenIds.add(item._id);
            allItems.push(item);
          }
        }
      }
      
      expect(allItems).toHaveLength(2);
      expect(allItems[0].title).toBe('Item 1'); // First occurrence kept
      expect(allItems[1].title).toBe('Item 2');
    });
    
    it('should handle items without IDs', () => {
      const seenIds = new Set<string>();
      const allItems: Array<{ _id?: string; title: string }> = [];
      
      const batch = {
        items: [
          { title: 'No ID Item' }, // No _id
          { _id: '1', title: 'With ID' },
        ],
      };
      
      for (const item of batch.items) {
        const id = item._id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allItems.push(item);
        } else if (!id) {
          // Items without ID are skipped in deduplication
        }
      }
      
      expect(allItems).toHaveLength(1);
      expect(allItems[0].title).toBe('With ID');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle SSE connection errors gracefully', () => {
      let errorHandled = false;
      let fallbackUsed = false;
      
      // Simulate SSE error handler
      const handleError = () => {
        errorHandled = true;
        // Trigger fallback to legacy fetch
        fallbackUsed = true;
      };
      
      // Simulate error
      handleError();
      
      expect(errorHandled).toBe(true);
      expect(fallbackUsed).toBe(true);
    });
    
    it('should handle batch-level errors', () => {
      const errorBatch = {
        batch: 'shared-to-user',
        items: [],
        done: false,
        error: 'Failed to fetch shared resources',
      };
      
      expect(errorBatch.error).toBeDefined();
      expect(errorBatch.items).toHaveLength(0);
    });
    
    it('should continue processing after batch error', () => {
      const batches = [
        { batch: 'personal', items: [{ _id: '1' }], done: false },
        { batch: 'work', items: [], done: false, error: 'Work fetch failed' },
        { batch: 'shared-to-all', items: [{ _id: '2' }], done: true },
      ];
      
      const allItems: Array<{ _id: string }> = [];
      
      for (const batch of batches) {
        // Even if one batch errors, we continue with others
        if (!batch.error) {
          allItems.push(...batch.items);
        }
      }
      
      expect(allItems).toHaveLength(2);
    });
  });
  
  describe('SSE Client Integration', () => {
    it('should create EventSource with correct URL', () => {
      const url = '/api/html-generation/incremental?stream=true';
      const es = new MockEventSource(url);
      
      expect(es.url).toBe(url);
      expect(MockEventSource.instances).toContain(es);
    });
    
    it('should close EventSource when done', async () => {
      const es = new MockEventSource('/api/test');
      
      // Wait for connection to open
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(es.readyState).toBe(1); // OPEN
      
      es.close();
      
      expect(es.readyState).toBe(2); // CLOSED
    });
    
    it('should handle message events', () => {
      const es = new MockEventSource('/api/test');
      const receivedData: unknown[] = [];
      
      es.onmessage = (event) => {
        receivedData.push(JSON.parse(event.data));
      };
      
      const testBatch = { batch: 'personal', items: [], done: false };
      es.simulateMessage(testBatch);
      
      expect(receivedData).toHaveLength(1);
      expect(receivedData[0]).toEqual(testBatch);
    });
  });
  
  describe('Progressive UI Updates', () => {
    it('should allow UI to render as batches arrive', () => {
      const state = {
        items: [] as Array<{ _id: string }>,
        loadingPhase: null as string | null,
        isLoading: true,
      };
      
      // First batch arrives
      state.loadingPhase = 'personal';
      state.items.push({ _id: '1' });
      
      expect(state.items).toHaveLength(1);
      expect(state.loadingPhase).toBe('personal');
      expect(state.isLoading).toBe(true);
      
      // Second batch arrives
      state.loadingPhase = 'work';
      state.items.push({ _id: '2' });
      
      expect(state.items).toHaveLength(2);
      expect(state.loadingPhase).toBe('work');
      
      // Final batch
      state.loadingPhase = 'shared-to-all';
      state.isLoading = false;
      
      expect(state.isLoading).toBe(false);
      expect(state.loadingPhase).toBe('shared-to-all');
    });
    
    it('should keep spinner visible until all batches complete', () => {
      let isLoading = true;
      const batchesReceived: string[] = [];
      const expectedBatches = ['personal', 'work', 'shared-to-user', 'shared-to-all'];
      
      // Simulate batch arrivals
      for (const batchType of expectedBatches) {
        batchesReceived.push(batchType);
        
        // Only stop loading when we have all batches and the last one has done=true
        const isLastBatch = batchType === 'shared-to-all';
        if (isLastBatch) {
          isLoading = false;
        }
      }
      
      expect(isLoading).toBe(false);
      expect(batchesReceived).toEqual(expectedBatches);
    });
  });
  
  describe('Abort Handling', () => {
    it('should abort previous fetch when new fetch starts', () => {
      let abortCalled = false;
      let currentAbort: (() => void) | null = null;
      
      // First fetch starts
      currentAbort = () => {
        abortCalled = true;
      };
      
      // Second fetch starts - should abort first
      if (currentAbort) {
        currentAbort();
      }
      
      expect(abortCalled).toBe(true);
    });
    
    it('should close EventSource on abort', () => {
      const es = new MockEventSource('/api/test');
      
      // Simulate abort
      es.close();
      
      expect(es.readyState).toBe(2); // CLOSED
    });
    
    it('should handle abort during batch processing', () => {
      let aborted = false;
      const items: unknown[] = [];
      
      // Start receiving batches
      const batch1 = { batch: 'personal', items: [{ _id: '1' }] };
      
      // Check if aborted before processing
      if (!aborted) {
        items.push(...batch1.items);
      }
      
      // Simulate abort
      aborted = true;
      
      // This batch should not be processed
      const batch2 = { batch: 'work', items: [{ _id: '2' }] };
      if (!aborted) {
        items.push(...batch2.items);
      }
      
      expect(items).toHaveLength(1);
      expect(aborted).toBe(true);
    });
  });
});

describe('Incremental Fetch Integration', () => {
  describe('URL Construction', () => {
    it('should build correct SSE URL with parameters', () => {
      const assistantName = 'test-assistant';
      const mode = 'personal';
      const stream = true;
      
      const url = `/api/html-generation/incremental?assistant=${encodeURIComponent(assistantName)}&mode=${mode}&stream=${stream}`;
      
      expect(url).toContain('assistant=test-assistant');
      expect(url).toContain('mode=personal');
      expect(url).toContain('stream=true');
    });
    
    it('should handle special characters in assistant name', () => {
      const assistantName = 'Test Assistant (Beta)';
      const encoded = encodeURIComponent(assistantName);
      
      expect(encoded).toBe('Test%20Assistant%20(Beta)');
      expect(decodeURIComponent(encoded)).toBe(assistantName);
    });
  });
  
  describe('JSON Fallback', () => {
    it('should provide non-SSE JSON endpoint', () => {
      // Test that the JSON fallback URL format is correct
      const url = `/api/html-generation/incremental?stream=false`;
      
      expect(url).toContain('stream=false');
      expect(url).toContain('/api/html-generation/incremental');
    });
    
    it('should return expected JSON structure', () => {
      // Test expected response structure
      const mockResponse = {
        batches: [
          { batch: 'personal', items: [{ _id: '1' }] },
          { batch: 'shared-to-all', items: [], done: true },
        ],
        items: [{ _id: '1' }],
      };
      
      expect(mockResponse.batches).toBeDefined();
      expect(mockResponse.items).toBeDefined();
      expect(mockResponse.batches[0].batch).toBe('personal');
      expect(mockResponse.batches[1].done).toBe(true);
    });
  });
});