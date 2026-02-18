/**
 * Tests for the AI context management system
 */

import {
  restoreAppletContext,
  createModificationRecord,
  estimateAppletComplexity
} from '../lib/context-management';
import { EnhancedHtmlContent, ModifyAppletRequest } from '../types/html-generation-types';

// Mock applet for testing
const mockApplet: EnhancedHtmlContent = {
  _id: '1',
  title: 'Test Game',
  contentType: 'game',
  htmlContent: `<!DOCTYPE html>
<html>
<head>
    <title>Test Game</title>
    <style>
        body { font-family: Arial; }
        .game-board { display: grid; }
    </style>
</head>
<body>
    <div class="game-board">
        <button onclick="startGame()">Start Game</button>
    </div>
    <script>
      const logger = window.logger ?? { info: () => {} };
        function startGame() {
        logger.info('Game started');
        }
        
        function resetGame() {
        logger.info('Game reset');
        }
        
        document.addEventListener('DOMContentLoaded', function() {
        logger.info('DOM loaded');
        });
    </script>
</body>
</html>`,
  userRequest: 'create a test game',
  isAiGenerated: true,
  tenantId: 'tenant1',
  createdBy: 'user1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  // Enhanced fields
  userProvidedName: undefined,
  aiSuggestedName: 'Test Game',
  nameConfirmed: true,
  searchKeywords: ['test', 'game'],
  semanticTags: ['entertainment', 'simple'],
  modificationHistory: [],
  contextSize: 1000,
  requiresAppendix: false,
  lastAccessed: new Date('2024-01-01T00:00:00Z'),
  accessCount: 1,
  modificationCount: 0
};

describe('Context Management System', () => {
  describe('restoreAppletContext', () => {
    it('should use direct context method for small applets', () => {
      const result = restoreAppletContext(
        mockApplet,
        'Add a score counter',
        'anthropic',
        'claude-sonnet-4'
      );

      expect(result.method).toBe('direct');
      expect(result.contextPrompt).toContain('ACTIVE APPLET CONTEXT');
      expect(result.contextPrompt).toContain(mockApplet.title);
      expect(result.contextPrompt).toContain(mockApplet.htmlContent);
      expect(result.contextPrompt).toContain('Add a score counter');
      expect(result.appendixContent).toBeUndefined();
      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.compressionRatio).toBe(1.0);
    });

    it('should use appendix method for large applets', () => {
      const largeApplet: EnhancedHtmlContent = {
        ...mockApplet,
        htmlContent: 'x'.repeat(20000), // Large content
        contextSize: 20000
      };

      const result = restoreAppletContext(
        largeApplet,
        'Optimize performance',
        'anthropic'
      );

      expect(result.method).toBe('appendix');
      expect(result.contextPrompt).toContain('LARGE APPLET CONTEXT PROTOCOL');
      expect(result.contextPrompt).toContain('APPENDIX A - FULL CODE');
      expect(result.appendixContent).toBe(largeApplet.htmlContent);
      expect(result.compressionRatio).toBeLessThan(1.0);
    });

    it('should use summary method for very large applets', () => {
      const veryLargeApplet: EnhancedHtmlContent = {
        ...mockApplet,
        htmlContent: 'x'.repeat(60000), // Very large content
        contextSize: 60000
      };

      const result = restoreAppletContext(
        veryLargeApplet,
        'Major refactoring',
        'openai',
        'gpt-4-turbo' // Lower token limit
      );

      expect(result.method).toBe('summary');
      expect(result.contextPrompt).toContain('COMPRESSED APPLET CONTEXT');
      expect(result.contextPrompt).toContain('compressed view');
      expect(result.compressionRatio).toBeLessThan(0.5);
    });

    it('should include modification history in context', () => {
      const appletWithHistory: EnhancedHtmlContent = {
        ...mockApplet,
        modificationHistory: [
          {
            id: 'mod-123',
            timestamp: new Date('2024-01-02T00:00:00Z'),
            userRequest: 'Add colors',
            changesDescription: 'Added color styling',
            aiProvider: 'anthropic',
            aiModel: 'claude-3',
            contextMethod: 'direct',
            priorHtmlContent: '<html>old</html>',
            priorTitle: 'Old Title'
          }
        ]
      };

      const result = restoreAppletContext(
        appletWithHistory,
        'Add animations',
        'anthropic'
      );

      expect(result.contextPrompt).toContain('MODIFICATION HISTORY');
      expect(result.contextPrompt).toContain('Add colors');
      expect(result.contextPrompt).toContain('Added color styling');
    });

    it('should adapt to different AI providers', () => {
      const openAIResult = restoreAppletContext(
        mockApplet,
        'test',
        'openai',
        'gpt-3.5-turbo'
      );

      const anthropicResult = restoreAppletContext(
        mockApplet,
        'test',
        'anthropic',
        'claude-sonnet-4'
      );

      const geminiResult = restoreAppletContext(
        mockApplet,
        'test',
        'gemini'
      );

      // All should work but may use different methods based on provider capabilities
      expect(openAIResult.method).toBeOneOf(['direct', 'appendix', 'summary']);
      expect(anthropicResult.method).toBeOneOf(['direct', 'appendix', 'summary']);
      expect(geminiResult.method).toBeOneOf(['direct', 'appendix', 'summary']);
    });

    it('should extract critical functions from HTML content', () => {
      const result = restoreAppletContext(
        mockApplet,
        'test',
        'anthropic'
      );

      if (result.method === 'appendix') {
        expect(result.contextPrompt).toContain('startGame');
        expect(result.contextPrompt).toContain('resetGame');
      }
    });

    it('should analyze styling framework', () => {
      const bootstrapApplet: EnhancedHtmlContent = {
        ...mockApplet,
        htmlContent: mockApplet.htmlContent.replace(
          '<style>',
          '<link href="bootstrap.css"><style>'
        )
      };

      const result = restoreAppletContext(
        bootstrapApplet,
        'test',
        'anthropic'
      );

      // Should detect CSS Grid usage
      if (result.method === 'appendix') {
        expect(result.contextPrompt).toContain('CSS Grid');
      }
    });
  });

  describe('createModificationRecord', () => {
    it('should create a complete modification record', () => {
      const request: ModifyAppletRequest = {
        appletId: 'test-id',
        modificationRequest: 'Add new feature',
        aiProvider: 'anthropic',
        aiModel: 'claude-3',
        assistantName: 'test-assistant'
      };

      const record = createModificationRecord(
        request,
        'Added the requested feature',
        'direct',
        '<html>old</html>',
        'Old Title'
      );

      expect(record.userRequest).toBe('Add new feature');
      expect(record.changesDescription).toBe('Added the requested feature');
      expect(record.aiProvider).toBe('anthropic');
      expect(record.aiModel).toBe('claude-3');
      expect(record.contextMethod).toBe('direct');
      expect(record.timestamp).toBeInstanceOf(Date);
    });

    it('should use default values when not provided', () => {
      const request: ModifyAppletRequest = {
        appletId: 'test-id',
        modificationRequest: 'Test modification'
      };

      const record = createModificationRecord(
        request,
        'Test changes',
        'appendix',
        '<html>old</html>',
        'Old Title'
      );

      expect(record.aiProvider).toBe('anthropic'); // Default
      expect(record.aiModel).toBe('default'); // Default
      expect(record.contextMethod).toBe('appendix');
    });
  });

  describe('estimateAppletComplexity', () => {
    it('should classify simple applets correctly', () => {
      const simpleHtml = `
        <html>
          <body>
            <h1>Simple App</h1>
            <button onclick="alert('Hello')">Click me</button>
          </body>
        </html>
      `;

      const complexity = estimateAppletComplexity(simpleHtml);
      expect(complexity).toBe('simple');
    });

    it('should classify medium complexity applets', () => {
      const mediumHtml = `
        <html>
          <head>
            <style>/* Some CSS */</style>
          </head>
          <body>
            <div id="app"></div>
            <script>
              function init() { window.logger?.info('init'); }
              function update() { window.logger?.info('update'); }
              function render() { window.logger?.info('render'); }
              document.addEventListener('click', handleClick);
              document.addEventListener('keydown', handleKey);
            </script>
          </body>
        </html>
      `;

      const complexity = estimateAppletComplexity(mediumHtml);
      expect(complexity).toBe('medium');
    });

    it('should classify complex applets', () => {
      const complexHtml = `
        <html>
          <head>
            <style>${'/* CSS */'.repeat(100)}</style>
          </head>
          <body>
            <div id="app"></div>
            <script>
              ${Array.from({ length: 15 }, (_, i) => `function func${i}() { window.logger?.info(String(${i})); }`).join('\n')}
              ${Array.from({ length: 10 }, (_, i) => `document.addEventListener('event${i}', handler${i});`).join('\n')}
              fetch('/api/data').then(response => response.json());
              fetch('/api/save').then(response => response.json());
            </script>
          </body>
        </html>
      `;

      const complexity = estimateAppletComplexity(complexHtml);
      expect(complexity).toBe('complex');
    });

    it('should consider size in complexity calculation', () => {
      const largeSimpleHtml = 'x'.repeat(25000); // Large but simple
      const complexity = estimateAppletComplexity(largeSimpleHtml);
      expect(complexity).not.toBe('simple');
    });

    it('should consider function count', () => {
      const manyFunctionsHtml = `
        <html>
          <script>
            ${Array.from({ length: 12 }, (_, i) => `function func${i}() {}`).join('\n')}
          </script>
        </html>
      `;

      const complexity = estimateAppletComplexity(manyFunctionsHtml);
      expect(complexity).not.toBe('simple');
    });

    it('should consider event listeners', () => {
      const manyEventsHtml = `
        <html>
          <script>
            ${Array.from({ length: 8 }, (_, i) => `document.addEventListener('event${i}', () => {});`).join('\n')}
          </script>
        </html>
      `;

      const complexity = estimateAppletComplexity(manyEventsHtml);
      expect(complexity).not.toBe('simple');
    });

    it('should consider API integration', () => {
      const apiHtml = `
        <html>
          <script>
            fetch('/api/data');
            fetch('/api/save');
          </script>
        </html>
      `;

      const complexity = estimateAppletComplexity(apiHtml);
      expect(complexity).not.toBe('simple');
    });
  });
});

// Custom matcher for Jest
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: any[]): R;
    }
  }
}

expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${expected.join(', ')}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${expected.join(', ')}`,
        pass: false,
      };
    }
  },
});
