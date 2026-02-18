/**
 * AI Context Management System for HTML Applets
 * 
 * This module handles:
 * - Full code context restoration for AI assistants
 * - Smart truncation and appendix method for large applets
 * - Context compression and summarization
 * - Modification history tracking
 * - Context method selection (direct, appendix, summary)
 */

import { getLogger } from '@interface/lib/logger';

import { 
  EnhancedHtmlContent, 
  ModificationRecord,
  ModifyAppletRequest 
} from '../types/html-generation-types';

const log = getLogger('[html-generation.context-management]');

export interface ContextRestorationResult {
  method: 'direct' | 'appendix' | 'summary';
  contextPrompt: string;
  appendixContent?: string;
  estimatedTokens: number;
  compressionRatio?: number;
}

export interface AppletContextSummary {
  name: string;
  type: string;
  size: number;
  keyFeatures: string[];
  architecturalSummary: string;
  criticalFunctions: string[];
  stylingFramework: string;
  lastModified: string;
}

const MAX_DIRECT_CONTEXT_SIZE = 15000; // Characters
const MAX_TOKEN_ESTIMATE = 8000; // Approximate tokens
const TOKEN_TO_CHAR_RATIO = 0.25; // Rough estimate: 1 token ≈ 4 characters

/**
 * Restores full applet context for AI modification
 */
export function restoreAppletContext(
  applet: EnhancedHtmlContent,
  modificationRequest: string,
  aiProvider: string = 'anthropic',
  aiModel?: string
): ContextRestorationResult {
  const contextSize = applet.htmlContent.length;
  const estimatedTokens = Math.ceil(contextSize * TOKEN_TO_CHAR_RATIO);
  
  // Determine best context method based on size and complexity
  const method = selectContextMethod(contextSize, estimatedTokens, aiProvider, aiModel);
  
  switch (method) {
    case 'direct':
      return createDirectContext(applet, modificationRequest, estimatedTokens);
    
    case 'appendix':
      return createAppendixContext(applet, modificationRequest, estimatedTokens);
    
    case 'summary':
      return createSummaryContext(applet, modificationRequest, estimatedTokens);
    
    default:
      return createDirectContext(applet, modificationRequest, estimatedTokens);
  }
}

/**
 * Selects the appropriate context method based on content size and AI provider capabilities
 */
function selectContextMethod(
  contextSize: number,
  estimatedTokens: number,
  aiProvider: string,
  aiModel?: string
): 'direct' | 'appendix' | 'summary' {
  // Get provider-specific total context window limits
  const totalContextLimit = getProviderTokenLimit(aiProvider, aiModel);
  
  // Reserve space for output tokens (typically 4k-12k depending on model)
  const maxOutputTokens = getMaxOutputTokens(aiProvider, aiModel);
  const availableInputTokens = totalContextLimit - maxOutputTokens - 1000; // 1k buffer for safety
  
  log.info('Context selection', {
    totalContextLimit,
    maxOutputTokens,
    availableInputTokens,
    estimatedTokens,
    aiProvider,
    aiModel
  });
  
  // Use more conservative thresholds since we now have accurate context windows
  if (contextSize <= MAX_DIRECT_CONTEXT_SIZE && estimatedTokens <= availableInputTokens * 0.7) {
    return 'direct';
  }
  
  if (contextSize <= 50000 && estimatedTokens <= availableInputTokens * 0.9) {
    return 'appendix';
  }
  
  return 'summary';
}

/**
 * Gets maximum output tokens for AI provider/model combination
 */
function getMaxOutputTokens(aiProvider: string, aiModel?: string): number {
  switch (aiProvider) {
    case 'openai':
      if (aiModel === 'gpt-5' || aiModel === 'gpt-5-mini' || aiModel === 'gpt-5-nano' || aiModel === 'o3') return 12000;
      if (aiModel === 'gpt-4-turbo') return 4096;
      if (aiModel === 'gpt-3.5-turbo') return 4096;
      return 8000; // gpt-4o and gpt-4o-mini
    
    case 'anthropic':
      if (aiModel === 'claude-sonnet-4-20250514') return 12000;
      return 8000; // Other Claude models
    
    case 'gemini':
      return 8000;
    
    default:
      return 4096; // Conservative default
  }
}

/**
 * Gets total context window limit for AI provider/model combination
 * These are the total context windows, not just output limits
 */
function getProviderTokenLimit(aiProvider: string, aiModel?: string): number {
  switch (aiProvider) {
    case 'openai':
      if (aiModel === 'gpt-5' || aiModel === 'gpt-5-mini' || aiModel === 'gpt-5-nano' || aiModel === 'o3') return 200000; // New models have large context windows
      if (aiModel === 'gpt-4-turbo') return 128000; // gpt-4-turbo has 128k context window
      if (aiModel === 'gpt-3.5-turbo') return 16384; // gpt-3.5-turbo has 16k context window
      return 128000; // gpt-4o and gpt-4o-mini have 128k context window
    
    case 'anthropic':
      if (aiModel === 'claude-sonnet-4-20250514') return 200000; // New Sonnet 4 has 200k context window
      return 200000; // Other Claude models have 200k context window
    
    case 'gemini':
      return 32768; // Gemini has 32k context window
    
    default:
      return 16384; // Conservative default (16k)
  }
}

/**
 * Creates direct context prompt with full code injection
 */
function createDirectContext(
  applet: EnhancedHtmlContent,
  modificationRequest: string,
  estimatedTokens: number
): ContextRestorationResult {
  const contextPrompt = buildDirectContextPrompt(applet, modificationRequest);
  
  return {
    method: 'direct',
    contextPrompt,
    estimatedTokens,
    compressionRatio: 1.0
  };
}

/**
 * Creates appendix-based context for large applets
 */
function createAppendixContext(
  applet: EnhancedHtmlContent,
  modificationRequest: string,
  estimatedTokens: number
): ContextRestorationResult {
  const summary = generateAppletSummary(applet);
  const contextPrompt = buildAppendixContextPrompt(summary, modificationRequest);
  const appendixContent = applet.htmlContent;
  
  return {
    method: 'appendix',
    contextPrompt,
    appendixContent,
    estimatedTokens: Math.ceil(contextPrompt.length * TOKEN_TO_CHAR_RATIO),
    compressionRatio: contextPrompt.length / applet.htmlContent.length
  };
}

/**
 * Creates summarized context for very large applets
 */
function createSummaryContext(
  applet: EnhancedHtmlContent,
  modificationRequest: string,
  estimatedTokens: number
): ContextRestorationResult {
  const summary = generateAppletSummary(applet);
  const compressedCode = compressHtmlContent(applet.htmlContent);
  const contextPrompt = buildSummaryContextPrompt(summary, compressedCode, modificationRequest);
  
  return {
    method: 'summary',
    contextPrompt,
    estimatedTokens: Math.ceil(contextPrompt.length * TOKEN_TO_CHAR_RATIO),
    compressionRatio: contextPrompt.length / applet.htmlContent.length
  };
}

/**
 * Builds direct context prompt with full code
 */
function buildDirectContextPrompt(
  applet: EnhancedHtmlContent,
  modificationRequest: string
): string {
  const modificationHistory = formatModificationHistory(applet.modificationHistory || []);
  
  return `## CONTEXT RESTORATION PROTOCOL

You are now working with an existing HTML applet. Full context has been restored.

### ACTIVE APPLET CONTEXT:
==================
Name: "${applet.title}"
Type: ${applet.contentType}
Created: ${applet.createdAt}
Last Modified: ${applet.updatedAt}
Features: [${(applet.semanticTags || []).join(', ')}]
Original Request: "${applet.userRequest}"

### CURRENT HTML CODE:
\`\`\`html
${applet.htmlContent}
\`\`\`

${modificationHistory}

### CURRENT USER REQUEST:
"${modificationRequest}"

### MODIFICATION PROTOCOL:
1. **Code Analysis**: Understand current implementation
2. **Change Planning**: Plan modifications without breaking existing functionality  
3. **Targeted Updates**: Apply precise changes to specific sections
4. **Testing Guidance**: Suggest testing steps for modifications
5. **Rollback Safety**: Preserve backup of previous version

### RESPONSE FORMAT:
- Acknowledge current applet context
- Explain planned modifications
- Provide updated HTML code
- Highlight changed sections
- Suggest testing approach

### CONTEXT MANAGEMENT RULES:
- Always acknowledge the existing applet being modified
- Preserve all existing functionality unless explicitly asked to remove
- Highlight changes made in response
- Maintain coding standards from original implementation
- Handle large applets via smart code segmentation`;
}

/**
 * Builds appendix-based context prompt
 */
function buildAppendixContextPrompt(
  summary: AppletContextSummary,
  modificationRequest: string
): string {
  return `## LARGE APPLET CONTEXT PROTOCOL

For applets exceeding standard context limits, using the appendix method.

### APPLET CONTEXT SUMMARY:
====================
Name: "${summary.name}"
Type: ${summary.type}
Size: ${summary.size} characters
Key Features: [${summary.keyFeatures.join(', ')}]
Architecture: ${summary.architecturalSummary}

### MODIFICATION REQUEST:
"${modificationRequest}"

### APPENDIX A - FULL CODE:
[ATTACHED: Complete HTML content in separate context block]

### APPENDIX B - CRITICAL FUNCTIONS:
${summary.criticalFunctions.join('\n')}

### APPENDIX C - STYLING FRAMEWORK:
${summary.stylingFramework}

### MODIFICATION STRATEGY:
1. Review appendix for current implementation
2. Identify target modification areas
3. Apply changes with minimal disruption
4. Provide updated sections only (not full HTML)
5. Maintain consistency with existing patterns

### APPENDIX PROCESSING RULES:
- Summarize architecture and key components
- Extract critical JavaScript functions for context
- Identify CSS framework and styling patterns
- Provide incremental updates rather than full rewrites
- Maintain backward compatibility`;
}

/**
 * Builds summary-based context prompt
 */
function buildSummaryContextPrompt(
  summary: AppletContextSummary,
  compressedCode: string,
  modificationRequest: string
): string {
  return `## COMPRESSED APPLET CONTEXT

Working with a large applet using compressed context method.

### APPLET SUMMARY:
Name: "${summary.name}"
Type: ${summary.type}
Architecture: ${summary.architecturalSummary}
Key Features: [${summary.keyFeatures.join(', ')}]

### COMPRESSED CODE STRUCTURE:
\`\`\`html
${compressedCode}
\`\`\`

### MODIFICATION REQUEST:
"${modificationRequest}"

### APPROACH:
1. Understand the compressed structure
2. Plan targeted modifications
3. Provide specific code updates
4. Maintain architectural consistency

Note: This is a compressed view. Focus on structural changes and key functionality updates.`;
}

/**
 * Generates a comprehensive summary of an applet
 */
function generateAppletSummary(applet: EnhancedHtmlContent): AppletContextSummary {
  const htmlContent = applet.htmlContent;
  const criticalFunctions = extractCriticalFunctions(htmlContent);
  const stylingFramework = analyzeStylingFramework(htmlContent);
  const architecturalSummary = analyzeArchitecture(htmlContent);
  
  return {
    name: applet.title,
    type: applet.contentType,
    size: htmlContent.length,
    keyFeatures: applet.semanticTags || [],
    architecturalSummary,
    criticalFunctions,
    stylingFramework,
    lastModified: applet.updatedAt || applet.createdAt || new Date().toISOString()
  };
}

/**
 * Extracts critical JavaScript functions from HTML content
 */
function extractCriticalFunctions(htmlContent: string): string[] {
  const functions: string[] = [];
  
  // Extract function declarations
  const functionPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)|(\w+)\s*:\s*function)/g;
  let match;
  
  while ((match = functionPattern.exec(htmlContent)) !== null) {
    const functionName = match[1] || match[2] || match[3];
    if (functionName && !functions.includes(functionName)) {
      functions.push(functionName);
    }
  }
  
  // Extract event handlers
  const eventPattern = /addEventListener\s*\(\s*['"](\w+)['"]/g;
  const eventHandlers: string[] = [];
  while ((match = eventPattern.exec(htmlContent)) !== null) {
    eventHandlers.push(`Event: ${match[1]}`);
  }
  
  return [...functions.slice(0, 10), ...eventHandlers.slice(0, 5)];
}

/**
 * Analyzes the styling framework used in the HTML
 */
function analyzeStylingFramework(htmlContent: string): string {
  const frameworks: string[] = [];
  
  if (htmlContent.includes('bootstrap') || htmlContent.includes('btn-')) {
    frameworks.push('Bootstrap');
  }
  
  if (htmlContent.includes('tailwind') || htmlContent.includes('bg-') || htmlContent.includes('text-')) {
    frameworks.push('Tailwind CSS');
  }
  
  if (htmlContent.includes('material') || htmlContent.includes('mdc-')) {
    frameworks.push('Material Design');
  }
  
  if (htmlContent.includes('fluent') || htmlContent.includes('ms-')) {
    frameworks.push('Fluent UI');
  }
  
  // Check for CSS Grid and Flexbox
  const hasGrid = htmlContent.includes('display: grid') || htmlContent.includes('grid-template');
  const hasFlex = htmlContent.includes('display: flex') || htmlContent.includes('flex-direction');
  
  if (hasGrid) frameworks.push('CSS Grid');
  if (hasFlex) frameworks.push('Flexbox');
  
  // Check for CSS variables
  if (htmlContent.includes('--') && htmlContent.includes('var(')) {
    frameworks.push('CSS Variables');
  }
  
  return frameworks.length > 0 
    ? `Uses: ${frameworks.join(', ')}`
    : 'Custom CSS styling';
}

/**
 * Analyzes the overall architecture of the HTML applet
 */
function analyzeArchitecture(htmlContent: string): string {
  const features: string[] = [];
  
  // Check for single-page app patterns
  if (htmlContent.includes('addEventListener') && htmlContent.includes('DOMContentLoaded')) {
    features.push('Event-driven SPA');
  }
  
  // Check for state management
  if (htmlContent.includes('let ') && htmlContent.includes('state')) {
    features.push('Local state management');
  }
  
  // Check for API integration
  if (htmlContent.includes('fetch(') || htmlContent.includes('XMLHttpRequest')) {
    features.push('API integration');
  }
  
  // Check for local storage
  if (htmlContent.includes('localStorage') || htmlContent.includes('sessionStorage')) {
    features.push('Browser storage');
  }
  
  // Check for canvas/graphics
  if (htmlContent.includes('<canvas') || htmlContent.includes('getContext')) {
    features.push('Canvas graphics');
  }
  
  // Check for form handling
  if (htmlContent.includes('<form') && htmlContent.includes('submit')) {
    features.push('Form handling');
  }
  
  // Check for real-time features
  if (htmlContent.includes('setInterval') || htmlContent.includes('setTimeout')) {
    features.push('Timer-based updates');
  }
  
  return features.length > 0
    ? features.join(', ')
    : 'Static HTML application';
}

/**
 * Compresses HTML content by removing comments, extra whitespace, and non-essential parts
 */
function compressHtmlContent(htmlContent: string): string {
  let compressed = htmlContent;
  
  // Remove HTML comments
  compressed = compressed.replace(/<!--[\s\S]*?-->/g, '');
  
  // Remove JavaScript comments
  compressed = compressed.replace(/\/\*[\s\S]*?\*\//g, '');
  compressed = compressed.replace(/\/\/.*$/gm, '');
  
  // Compress CSS by removing extra whitespace
  compressed = compressed.replace(/\s*{\s*/g, '{');
  compressed = compressed.replace(/\s*}\s*/g, '}');
  compressed = compressed.replace(/;\s*/g, ';');
  
  // Remove extra whitespace between HTML tags
  compressed = compressed.replace(/>\s+</g, '><');
  
  // Normalize line breaks
  compressed = compressed.replace(/\n\s*\n/g, '\n');
  
  // If still too long, extract just the structure
  if (compressed.length > 5000) {
    compressed = extractStructuralElements(compressed);
  }
  
  return compressed;
}

/**
 * Extracts key structural elements from HTML for summary view
 */
function extractStructuralElements(htmlContent: string): string {
  const elements: string[] = [];
  
  // Extract head section (simplified)
  const headMatch = htmlContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    elements.push('<head><!-- CSS and meta tags --></head>');
  }
  
  // Extract main structural elements
  const structuralTags = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'div'];
  
  for (const tag of structuralTags) {
    const pattern = new RegExp(`<${tag}[^>]*>`, 'gi');
    const matches = htmlContent.match(pattern);
    if (matches) {
      elements.push(...matches.slice(0, 3)); // Limit to first 3 of each type
    }
  }
  
  // Extract key JavaScript function signatures
  const funcPattern = /function\s+\w+\s*\([^)]*\)/g;
  const functions = htmlContent.match(funcPattern);
  if (functions) {
    elements.push('\n// Key functions:');
    elements.push(...functions.slice(0, 5).map(f => `// ${f}`));
  }
  
  return elements.join('\n');
}

/**
 * Formats modification history for context prompt
 */
function formatModificationHistory(history: ModificationRecord[]): string {
  if (history.length === 0) {
    return '### MODIFICATION HISTORY:\nNo previous modifications recorded.';
  }
  
  const formatted = history
    .slice(-3) // Show last 3 modifications
    .map((record, index) => {
      return `${index + 1}. ${record.timestamp.toISOString()}
   Request: "${record.userRequest}"
   Changes: ${record.changesDescription}
   Method: ${record.contextMethod} (${record.aiProvider}${record.aiModel ? `:${record.aiModel}` : ''})`;
    })
    .join('\n\n');
  
  return `### MODIFICATION HISTORY:\n${formatted}`;
}

/**
 * Creates a modification record for tracking changes
 */
export function createModificationRecord(
  request: ModifyAppletRequest,
  changesDescription: string,
  contextMethod: 'direct' | 'appendix' | 'summary',
  priorHtmlContent: string,
  priorTitle: string
): ModificationRecord {
  return {
    id: `mod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date(),
    userRequest: request.modificationRequest,
    changesDescription,
    aiProvider: request.aiProvider || 'anthropic',
    aiModel: request.aiModel || 'default',
    contextMethod,
    priorHtmlContent,
    priorTitle
  };
}

/**
 * Estimates the complexity of an applet based on its content
 */
export function estimateAppletComplexity(htmlContent: string): 'simple' | 'medium' | 'complex' {
  const size = htmlContent.length;
  
  // Count various function patterns
  const namedFunctions = (htmlContent.match(/function\s+\w+/g) || []).length;
  const anonymousFunctions = (htmlContent.match(/function\s*\(/g) || []).length;
  const arrowFunctions = (htmlContent.match(/=>\s*[{(]/g) || []).length;
  const methodDefinitions = (htmlContent.match(/\w+\s*:\s*function/g) || []).length;
  const functionCount = namedFunctions + anonymousFunctions + arrowFunctions + methodDefinitions;
  
  const eventListeners = (htmlContent.match(/addEventListener/g) || []).length;
  const onClickHandlers = (htmlContent.match(/onclick\s*=/g) || []).length;
  const totalEventHandlers = eventListeners + onClickHandlers;
  
  const apiCalls = (htmlContent.match(/fetch\(/g) || []).length;
  
  let complexityScore = 0;
  
  // Size factor
  if (size > 20000) complexityScore += 3;
  else if (size > 10000) complexityScore += 2;
  else if (size > 5000) complexityScore += 1;
  
  // Function count factor
  if (functionCount > 10) complexityScore += 3;
  else if (functionCount > 5) complexityScore += 2;
  else if (functionCount > 2) complexityScore += 1;
  
  // Interactivity factor
  if (totalEventHandlers > 5) complexityScore += 2;
  else if (totalEventHandlers >= 2) complexityScore += 1;
  
  // API integration factor
  if (apiCalls > 0) complexityScore += 2;
  
  if (complexityScore >= 6) return 'complex';
  if (complexityScore >= 2) return 'medium';
  return 'simple';
}
