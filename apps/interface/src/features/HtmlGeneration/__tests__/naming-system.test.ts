/**
 * Tests for the applet naming system
 */

import {
  analyzeNamingIntent,
  validateAppletName,
  extractSearchKeywords,
  generateSemanticTags
} from '../lib/naming-system';
import { HtmlContentType } from '../types/html-generation-types';

describe('Naming System', () => {
  describe('analyzeNamingIntent', () => {
    it('should use user-provided name when explicitly provided', () => {
      const result = analyzeNamingIntent(
        'create a simple game',
        'game',
        'A fun game',
        'My Custom Game'
      );

      expect(result.extractedName).toBe('My Custom Game');
      expect(result.suggestedName).toBe('My Custom Game');
      expect(result.requiresConfirmation).toBe(false);
      expect(result.isUserProvided).toBe(true);
    });

    it('should extract name from user request patterns', () => {
      const testCases = [
        {
          request: 'create a game called "Tic Tac Toe Master"',
          expected: 'Tic Tac Toe Master'
        },
        {
          request: 'make a tool named "Color Picker"',
          expected: 'Color Picker'
        },
        {
          request: 'build an app called Ultimate Todo',
          expected: 'Ultimate Todo'
        }
      ];

      testCases.forEach(({ request, expected }) => {
        const result = analyzeNamingIntent(request, 'game', 'test');
        expect(result.extractedName).toBe(expected);
        expect(result.isUserProvided).toBe(true);
      });
    });

    it('should generate appropriate suggestions for different content types', () => {
      const testCases = [
        {
          request: 'create a tic tac toe game',
          contentType: 'game' as HtmlContentType,
          expected: 'Tic Tac Toe Game'
        },
        {
          request: 'make a todo app',
          contentType: 'app' as HtmlContentType,
          expected: 'Task Manager'
        },
        {
          request: 'build a calculator tool',
          contentType: 'tool' as HtmlContentType,
          expected: 'Calculator Tool'
        },
        {
          request: 'create an interactive demo',
          contentType: 'interactive' as HtmlContentType,
          expected: 'Interactive Demo'
        }
      ];

      testCases.forEach(({ request, contentType, expected }) => {
        const result = analyzeNamingIntent(request, contentType, 'test');
        expect(result.suggestedName).toBe(expected);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.isUserProvided).toBe(false);
      });
    });
  });

  describe('validateAppletName', () => {
    it('should validate acceptable names', () => {
      const result = validateAppletName('My Great App');
      
      expect(result.isValid).toBe(true);
      expect(result.sanitizedName).toBe('My Great App');
      expect(result.conflicts).toHaveLength(0);
      expect(result.suggestedAlternatives).toHaveLength(0);
    });

    it('should reject names that are too short', () => {
      const result = validateAppletName('Hi');
      
      expect(result.isValid).toBe(false);
      expect(result.suggestedAlternatives).toContain('Hi App');
    });

    it('should reject names that are too long', () => {
      const longName = 'A'.repeat(60);
      const result = validateAppletName(longName);
      
      expect(result.isValid).toBe(false);
      expect(result.sanitizedName).toContain('...');
    });

    it('should detect name conflicts and suggest alternatives', () => {
      const existingNames = ['My App', 'Another App'];
      const result = validateAppletName('My App', existingNames);
      
      expect(result.isValid).toBe(false);
      expect(result.conflicts).toContain('My App');
      expect(result.suggestedAlternatives).toContain('My App 2');
    });

    it('should sanitize invalid characters', () => {
      const result = validateAppletName('My@App#With$Symbols%');
      
      expect(result.sanitizedName).toBe('MyAppWithSymbols');
    });
  });

  describe('extractSearchKeywords', () => {
    it('should extract keywords from title, description, and request', () => {
      const keywords = extractSearchKeywords(
        'Tic Tac Toe Game',
        'A classic strategy game',
        'create a tic tac toe game with scoring',
        'game',
        ['strategy', 'classic']
      );

      expect(keywords).toContain('tic');
      expect(keywords).toContain('tac');
      expect(keywords).toContain('toe');
      expect(keywords).toContain('game');
      expect(keywords).toContain('classic');
      expect(keywords).toContain('strategy');
      expect(keywords).toContain('scoring');
    });

    it('should filter out stop words', () => {
      const keywords = extractSearchKeywords(
        'The Ultimate App',
        'This is the best app',
        'create the ultimate app for me',
        'app'
      );

      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('is');
      expect(keywords).not.toContain('for');
      expect(keywords).toContain('ultimate');
      expect(keywords).toContain('app');
      expect(keywords).toContain('best');
    });

    it('should limit keywords to reasonable number', () => {
      const longText = 'word '.repeat(50);
      const keywords = extractSearchKeywords(
        longText,
        longText,
        longText,
        'app'
      );

      expect(keywords.length).toBeLessThanOrEqual(20);
    });
  });

  describe('generateSemanticTags', () => {
    it('should generate appropriate tags for different content types', () => {
      const gameTagsResult = generateSemanticTags(
        'Snake Game',
        'Classic snake game',
        'make a snake game',
        'game'
      );

      expect(gameTagsResult).toContain('entertainment');
      expect(gameTagsResult).toContain('interactive');
      expect(gameTagsResult).toContain('fun');

      const appTagsResult = generateSemanticTags(
        'Todo App',
        'Task management app',
        'create a todo app',
        'app'
      );

      expect(appTagsResult).toContain('productivity');
      expect(appTagsResult).toContain('utility');
      expect(appTagsResult).toContain('application');
    });

    it('should detect feature-based tags', () => {
      const tags = generateSemanticTags(
        'Multiplayer Game',
        'A real-time multiplayer game with API integration',
        'create a multiplayer real-time game with API',
        'game'
      );

      expect(tags).toContain('multiplayer');
      expect(tags).toContain('real-time');
      expect(tags).toContain('api-integrated');
    });

    it('should detect complexity tags', () => {
      const simpleTags = generateSemanticTags(
        'Simple Calculator',
        'A basic calculator',
        'make a simple calculator',
        'tool'
      );

      const complexTags = generateSemanticTags(
        'Advanced System',
        'A complex advanced system',
        'build an advanced complex system',
        'app'
      );

      expect(simpleTags).toContain('simple');
      expect(complexTags).toContain('advanced');
    });

    it('should limit tags to reasonable number', () => {
      const tags = generateSemanticTags(
        'Title with many words that could generate tags',
        'Description with even more words that might create additional tags',
        'User request with lots of descriptive words that could become tags',
        'app'
      );

      expect(tags.length).toBeLessThanOrEqual(10);
    });
  });
});
