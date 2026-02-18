/**
 * User-controlled applet naming system with AI suggestion fallbacks
 * 
 * This module handles:
 * - Extracting user-provided names from requests
 * - Generating AI-suggested names based on functionality
 * - Name uniqueness validation within tenant scope
 * - Name normalization and sanitization
 */

import { HtmlContentType } from '../types/html-generation-types';

export interface NamingResult {
  extractedName?: string;
  suggestedName: string;
  requiresConfirmation: boolean;
  isUserProvided: boolean;
}

export interface NameValidationResult {
  isValid: boolean;
  sanitizedName: string;
  conflicts: string[];
  suggestedAlternatives: string[];
}

/**
 * Analyzes a user request to extract naming intent and generate suggestions
 */
export function analyzeNamingIntent(
  userRequest: string,
  contentType: HtmlContentType,
  description: string,
  userProvidedName?: string
): NamingResult {
  // If user explicitly provided a name, use it
  if (userProvidedName?.trim()) {
    return {
      extractedName: userProvidedName.trim(),
      suggestedName: userProvidedName.trim(),
      requiresConfirmation: false,
      isUserProvided: true
    };
  }

  // Try to extract name from user request
  const extractedName = extractNameFromRequest(userRequest);
  if (extractedName) {
    return {
      extractedName,
      suggestedName: extractedName,
      requiresConfirmation: true,
      isUserProvided: true
    };
  }

  // Generate AI suggestion based on functionality
  const suggestedName = generateNameSuggestion(userRequest, contentType, description);
  return {
    suggestedName,
    requiresConfirmation: true,
    isUserProvided: false
  };
}

/**
 * Attempts to extract an explicit name from the user's request
 */
function extractNameFromRequest(userRequest: string): string | null {
  // Look for explicit naming patterns (case insensitive)
  const patterns = [
    /(?:call|name) (?:it|this) ["']([^"']+)["']/i,
    /(?:call|name) (?:it|this) ([a-zA-Z0-9\s]+?)(?:\.|$)/i,
    /create (?:a |an )?["']([^"']+)["']/i,
    /make (?:a |an )?["']([^"']+)["']/i,
    /build (?:a |an )?["']([^"']+)["']/i,
    /title[:\s]+["']([^"']+)["']/i,
    /called ["']([^"']+)["']/i,
    /named ["']([^"']+)["']/i,
    // Patterns without quotes - more specific patterns first
    /(?:create|make|build)\s+(?:a|an)\s+(?:app|tool|game)\s+called\s+([a-zA-Z0-9\s]+)$/i,
    /(?:create|make|build)\s+(?:a|an)\s+(?:app|tool|game)\s+named\s+([a-zA-Z0-9\s]+)$/i,
    /(?:called|named)\s+([a-zA-Z0-9\s]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = userRequest.match(pattern);
    if (match?.[1]) {
      const extracted = match[1].trim();
      if (extracted.length >= 3 && extracted.length <= 50) {
        return toTitleCase(extracted);
      }
    }
  }

  return null;
}

/**
 * Generates a contextual name suggestion based on functionality
 */
function generateNameSuggestion(
  userRequest: string,
  contentType: HtmlContentType,
  description: string
): string {
  const request = userRequest.toLowerCase();
  const desc = description.toLowerCase();
  
  // Content type specific suggestions
  const typeBasedSuggestions = {
    game: generateGameName(request, desc),
    app: generateAppName(request, desc),
    tool: generateToolName(request, desc),
    interactive: generateInteractiveName(request, desc)
  };

  return typeBasedSuggestions[contentType] || generateGenericName(request, contentType);
}

function generateGameName(request: string, description: string): string {
  // Look for specific game types
  if (request.includes('tic tac toe') || request.includes('tictactoe')) {
    return 'Tic Tac Toe Game';
  }
  if (request.includes('snake')) {
    return 'Snake Game';
  }
  if (request.includes('puzzle')) {
    return 'Puzzle Game';
  }
  if (request.includes('memory')) {
    return 'Memory Game';
  }
  if (request.includes('card')) {
    return 'Card Game';
  }
  if (request.includes('quiz')) {
    return 'Quiz Game';
  }
  if (request.includes('trivia')) {
    return 'Trivia Game';
  }
  if (request.includes('word')) {
    return 'Word Game';
  }
  if (request.includes('math')) {
    return 'Math Game';
  }
  
  return 'Interactive Game';
}

function generateAppName(request: string, description: string): string {
  // Look for specific app types
  if (request.includes('todo') || request.includes('task')) {
    return 'Task Manager';
  }
  if (request.includes('note')) {
    return 'Notes App';
  }
  if (request.includes('chat')) {
    return 'Chat App';
  }
  if (request.includes('calendar')) {
    return 'Calendar App';
  }
  if (request.includes('weather')) {
    return 'Weather App';
  }
  if (request.includes('timer') || request.includes('stopwatch')) {
    return 'Timer App';
  }
  if (request.includes('counter')) {
    return 'Counter App';
  }
  if (request.includes('expense') || request.includes('budget')) {
    return 'Expense Tracker';
  }
  if (request.includes('habit')) {
    return 'Habit Tracker';
  }
  if (request.includes('journal') || request.includes('diary')) {
    return 'Journal App';
  }
  
  return 'Utility App';
}

function generateToolName(request: string, description: string): string {
  // Look for specific tool types
  if (request.includes('converter') || request.includes('convert')) {
    return 'Converter Tool';
  }
  if (request.includes('generator') || request.includes('generate')) {
    return 'Generator Tool';
  }
  if (request.includes('editor') || request.includes('edit')) {
    return 'Editor Tool';
  }
  if (request.includes('validator') || request.includes('validate')) {
    return 'Validator Tool';
  }
  if (request.includes('formatter') || request.includes('format')) {
    return 'Formatter Tool';
  }
  if (request.includes('analyzer') || request.includes('analyze')) {
    return 'Analyzer Tool';
  }
  if (request.includes('compressor') || request.includes('compress')) {
    return 'Compression Tool';
  }
  if (request.includes('color') || request.includes('palette')) {
    return 'Color Tool';
  }
  
  return 'Utility Tool';
}

function generateInteractiveName(request: string, description: string): string {
  // Look for specific interactive types
  if (request.includes('demo') || request.includes('demonstration')) {
    return 'Interactive Demo';
  }
  if (request.includes('tutorial')) {
    return 'Interactive Tutorial';
  }
  if (request.includes('guide')) {
    return 'Interactive Guide';
  }
  if (request.includes('presentation')) {
    return 'Interactive Presentation';
  }
  if (request.includes('story')) {
    return 'Interactive Story';
  }
  if (request.includes('simulation') || request.includes('simulator')) {
    return 'Interactive Simulation';
  }
  if (request.includes('visualization') || request.includes('chart')) {
    return 'Interactive Visualization';
  }
  
  return 'Interactive Experience';
}

export function generateGenericName(request: string, contentType: HtmlContentType): string {
  // Extract key words from the request for more contextual generic names
  const words = request.toLowerCase().split(/\s+/);
  
  // Enhanced keyword detection with more variety
  const gameWords = ['snake', 'tetris', 'pong', 'breakout', 'puzzle', 'card', 'memory', 'quiz', 'trivia', 'maze', 'shooter', 'platformer', 'rpg', 'racing', 'strategy', 'arcade', 'adventure'];
  const appWords = ['timer', 'clock', 'weather', 'note', 'todo', 'task', 'calendar', 'music', 'photo', 'gallery', 'editor', 'player', 'viewer', 'browser', 'chat', 'messenger'];
  const toolWords = ['converter', 'generator', 'validator', 'formatter', 'analyzer', 'encoder', 'decoder', 'compressor', 'optimizer', 'scanner', 'parser', 'transformer'];
  
  const foundGameWord = gameWords.find(word => words.some(w => w.includes(word)));
  const foundAppWord = appWords.find(word => words.some(w => w.includes(word)));
  const foundToolWord = toolWords.find(word => words.some(w => w.includes(word)));
  
  if (foundGameWord) return `${toTitleCase(foundGameWord)} Game`;
  if (foundAppWord) return `${toTitleCase(foundAppWord)} App`;
  if (foundToolWord) return `${toTitleCase(foundToolWord)} Tool`;

  // Extract key nouns/verbs from the request as fallback
  const keyWords = request.split(/\s+/).filter(word => 
    word.length > 3 && 
    !['create', 'make', 'build', 'generate', 'simple', 'basic', 'please', 'want', 'need'].includes(word.toLowerCase())
  );
  
  if (keyWords.length > 0) {
    const keyWord = toTitleCase(keyWords[0]);
    return `${keyWord} ${toTitleCase(contentType)}`;
  }
  
  // Generate more creative generic names based on content type
  const genericNames = {
    game: [
      'Fun Game', 'Interactive Game', 'Web Game', 'Browser Game', 'Quick Game', 
      'Arcade Game', 'Puzzle Game', 'Action Game', 'Casual Game', 'Mini Game'
    ],
    app: [
      'Productivity App', 'Utility App', 'Web App', 'Helper App', 'Smart App',
      'Quick App', 'Daily App', 'Personal App', 'Handy App', 'Digital App'
    ],
    tool: [
      'Useful Tool', 'Web Tool', 'Helper Tool', 'Quick Tool', 'Digital Tool',
      'Online Tool', 'Smart Tool', 'Handy Tool', 'Utility Tool', 'Pro Tool'
    ],
    interactive: [
      'Interactive Experience', 'Web Experience', 'Digital Experience', 'Interactive Tool',
      'Creative Tool', 'Learning Tool', 'Practice Tool', 'Demo Tool', 'Test Tool', 'Sample App'
    ]
  };
  
  const options = genericNames[contentType] || genericNames.interactive;
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex];
}

/**
 * Validates and sanitizes an applet name
 */
export function validateAppletName(
  name: string,
  existingNames: string[] = []
): NameValidationResult {
  const sanitized = sanitizeName(name);
  
  if (!sanitized) {
    return {
      isValid: false,
      sanitizedName: '',
      conflicts: [],
      suggestedAlternatives: ['My App', 'New App', 'Custom App']
    };
  }
  
  if (sanitized.length < 3) {
    return {
      isValid: false,
      sanitizedName: sanitized,
      conflicts: [],
      suggestedAlternatives: [
        `${sanitized} App`,
        `${sanitized} Tool`,
        `My ${sanitized}`
      ]
    };
  }
  
  if (sanitized.length > 50) {
    const truncated = sanitized.substring(0, 47) + '...';
    return {
      isValid: false,
      sanitizedName: truncated,
      conflicts: [],
      suggestedAlternatives: [truncated]
    };
  }
  
  const conflicts = existingNames.filter(existing => 
    existing.toLowerCase() === sanitized.toLowerCase()
  );
  
  if (conflicts.length > 0) {
    const alternatives = generateAlternativeNames(sanitized, existingNames);
    return {
      isValid: false,
      sanitizedName: sanitized,
      conflicts,
      suggestedAlternatives: alternatives
    };
  }
  
  return {
    isValid: true,
    sanitizedName: sanitized,
    conflicts: [],
    suggestedAlternatives: []
  };
}

/**
 * Sanitizes a name by removing invalid characters and normalizing whitespace
 */
function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/[^\w\s\-]/g, '') // Remove special chars except hyphens
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/^\-+|\-+$/g, '') // Remove leading/trailing hyphens
    .trim();
}

/**
 * Generates alternative names when conflicts exist
 */
function generateAlternativeNames(baseName: string, existingNames: string[]): string[] {
  const alternatives: string[] = [];
  const lowerExisting = existingNames.map(n => n.toLowerCase());
  
  // Try numbered variations
  for (let i = 2; i <= 5; i++) {
    const candidate = `${baseName} ${i}`;
    if (!lowerExisting.includes(candidate.toLowerCase())) {
      alternatives.push(candidate);
    }
  }
  
  // Try descriptive variations
  const descriptors = ['New', 'My', 'Custom', 'Updated', 'Enhanced'];
  for (const desc of descriptors) {
    const candidate = `${desc} ${baseName}`;
    if (!lowerExisting.includes(candidate.toLowerCase())) {
      alternatives.push(candidate);
    }
  }
  
  return alternatives.slice(0, 3); // Return top 3 alternatives
}

/**
 * Converts a string to title case
 */
function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extracts search keywords from applet content for indexing
 */
export function extractSearchKeywords(
  title: string,
  description: string,
  userRequest: string,
  contentType: HtmlContentType,
  tags: string[] = []
): string[] {
  const keywords = new Set<string>();
  
  // Add title words
  title.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 2 && !isStopWord(word)) {
      keywords.add(word);
    }
  });
  
  // Add description words
  description.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 2 && !isStopWord(word)) {
      keywords.add(word);
    }
  });
  
  // Add user request keywords
  userRequest.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 2 && !isStopWord(word)) {
      keywords.add(word);
    }
  });
  
  // Add content type
  keywords.add(contentType);
  
  // Add tags
  tags.forEach(tag => keywords.add(tag.toLowerCase()));
  
  return Array.from(keywords).slice(0, 20); // Limit to 20 keywords
}

/**
 * Generates semantic tags based on content analysis
 */
export function generateSemanticTags(
  title: string,
  description: string,
  userRequest: string,
  contentType: HtmlContentType
): string[] {
  const tags = new Set<string>();
  const text = `${title} ${description} ${userRequest}`.toLowerCase();
  
  // Content type specific tags
  const typeMapping = {
    game: ['entertainment', 'interactive', 'fun'],
    app: ['productivity', 'utility', 'application'],
    tool: ['utility', 'helper', 'productivity'],
    interactive: ['engaging', 'dynamic', 'interactive']
  };
  
  typeMapping[contentType].forEach(tag => tags.add(tag));
  
  // Feature-based tags
  if (text.includes('multiplayer') || text.includes('multi-player')) {
    tags.add('multiplayer');
  }
  if (text.includes('single') || text.includes('solo')) {
    tags.add('single-player');
  }
  if (text.includes('real-time') || text.includes('realtime')) {
    tags.add('real-time');
  }
  if (text.includes('responsive') || text.includes('mobile')) {
    tags.add('responsive');
  }
  if (text.includes('data') || text.includes('storage')) {
    tags.add('data-driven');
  }
  if (text.includes('api') || text.includes('integration')) {
    tags.add('api-integrated');
  }
  
  // Complexity tags
  if (text.includes('simple') || text.includes('basic')) {
    tags.add('simple');
  } else if (text.includes('advanced') || text.includes('complex')) {
    tags.add('advanced');
  } else {
    tags.add('intermediate');
  }
  
  return Array.from(tags).slice(0, 10); // Limit to 10 tags
}

/**
 * Check if a word is a stop word (common words to ignore in search)
 */
function isStopWord(word: string): boolean {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'the', 'this', 'but', 'they',
    'have', 'had', 'what', 'said', 'each', 'which', 'their', 'time',
    'can', 'could', 'would', 'should', 'make', 'create', 'build'
  ]);
  
  return stopWords.has(word.toLowerCase());
}
