/**
 * Example: Using bot tools manifest in TypeScript/JavaScript
 * 
 * This example shows how to import and use the bot tools manifest
 * in TypeScript/JavaScript code (Interface, Dashboard, NCP).
 */

// Import the manifest directly as JSON
import manifest from '../generated/bot-tools-manifest.json';
import { getLogger } from '../src/logger';

/**
 * Validate a FunctionalPrompt featureKey
 */
export function validateFeatureKey(featureKey: string): { valid: boolean; error?: string } {
  if (!featureKey) {
    return { valid: false, error: 'featureKey cannot be empty' };
  }
  
  if (!manifest.tool_names.includes(featureKey)) {
    return {
      valid: false,
      error: `Invalid featureKey '${featureKey}'. Must be one of ${manifest.tool_count} bot tools.`
    };
  }
  
  return { valid: true };
}

/**
 * Get all valid featureKey values for form dropdowns/enum validation
 */
export function getValidFeatureKeys(): string[] {
  return manifest.tool_names;
}

/**
 * Get tools organized by feature flag for UI display
 */
export function getToolsByFeature(): Record<string, string[]> {
  return manifest.by_feature;
}

/**
 * Suggest similar tool names for autocomplete/error messages
 */
export function suggestSimilarTools(input: string, maxSuggestions = 5): string[] {
  const lowerInput = input.toLowerCase();
  return manifest.tool_names
    .filter(tool => tool.toLowerCase().includes(lowerInput))
    .slice(0, maxSuggestions);
}

/**
 * Get tool metadata (description, parameters, category)
 */
export function getToolMetadata<T extends keyof typeof manifest.tools>(toolName: T) {
  return manifest.tools[toolName];
}

// Example usage
if (require.main === module) {
  const logger = getLogger('features:examples:bot-tools');
  logger.info('Bot Tools Manifest Example (TypeScript)');
  
  // Example 1: Validate featureKey
  logger.info('Example 1: Validate featureKey');
  const testKeys = ['bot_create_note', 'bot_invalid_tool', 'create_note'];
  testKeys.forEach(key => {
    const result = validateFeatureKey(key);
    if (result.valid) {
      logger.info('Feature key is valid', { key });
    } else {
      logger.warn('Feature key is invalid', { key, error: result.error });
      const suggestions = suggestSimilarTools(key);
      if (suggestions.length > 0) {
        logger.info('Feature key suggestions', { key, suggestions: suggestions.slice(0, 3) });
      }
    }
  });
  
  // Example 2: Get all valid values
  logger.info('Example 2: Get all valid featureKey values');
  const validKeys = getValidFeatureKeys();
  logger.info('Bot tool count', { count: validKeys.length });
  logger.info('First 5 bot tools', { tools: validKeys.slice(0, 5) });
  
  // Example 3: Tools by category
  logger.info('Example 3: Tools by category');
  const byFeature = getToolsByFeature();
  Object.entries(byFeature).sort().forEach(([feature, tools]) => {
    logger.info('Tools by feature', { feature, count: tools.length, examples: tools.slice(0, 3) });
  });
  
  // Example 4: Get tool metadata
  logger.info('Example 4: Tool metadata');
  const metadata = getToolMetadata('bot_create_note');
  logger.info('Tool metadata', {
    tool: metadata.name,
    category: metadata.category,
    description: metadata.description,
  });
}
