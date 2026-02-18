/**
 * Bot Tools Registry - Generated from @bot_tool decorators
 * 
 * This module provides type-safe access to the bot tools manifest that is
 * automatically generated from the pipecat-daily-bot decorator system.
 * 
 * The manifest is generated during build via:
 *   apps/pipecat-daily-bot/scripts/generate_tool_manifest.py
 * 
 * DO NOT manually edit tool lists - they are auto-generated from @bot_tool decorators.
 */

// Import the generated manifest
import manifest from '../generated/bot-tools-manifest.json';

/**
 * All bot tool names from the manifest
 * This replaces the hardcoded bot_ tool lists
 */
export const BOT_TOOL_NAMES: readonly string[] = manifest.tool_names;

/**
 * All tool names across the system
 * Combines interface tools with bot tools from manifest
 */
export const ALL_REGISTERED_TOOLS: readonly string[] = [
  // ========================================
  // INTERFACE APP TOOLS
  // From apps/interface/src/lib/tools/tool-definitions.ts
  // ========================================
  
  // Window Management (8)
  'minimizeWindow',
  'maximizeWindow',
  'restoreWindow',
  'snapWindowLeft',
  'snapWindowRight',
  'resetWindowPosition',
  'snapWindowCenter',
  'snapWindowMiddle',

  // View Management (2)
  'closeView',
  'closeBrowserWindow',

  // YouTube (4)
  'searchYouTubeVideos',
  'pauseYouTubeVideo',
  'playYouTubeVideo',
  'playNextYouTubeVideo',

  // Daily Video Call (1)
  'startDailyCall',

  // Desktop Mode (1)
  'switchDesktopMode',

  // Desktop Apps (7)
  'openGoogleDrive',
  'openGmail',
  'openCalculator',
  'openNotes',
  'openTerminal',
  'openBrowser',
  'openCreationEngine',

  // Mini Browser (1)
  'openEnhancedBrowser',

  // Notes (13)
  'createNote',
  'saveNote',
  'listNotes',
  'downloadNote',
  'readNoteContent',
  'writeNoteContent',
  'addNoteContent',
  'updateNoteContent',
  'removeNoteContent',
  'updateNoteTitle',
  'switchNoteMode',
  'deleteNote',
  'openNote',
  'backToNotes',

  // Wikipedia (1)
  'searchWikipedia',

  // HTML Content (4)
  'createHtmlContent',
  'loadHtmlApplet',
  'readHtmlAppletContent',
  'updateHtmlApplet',

  // User Profile (2)
  'saveUserProfile',
  'updateUserProfile',

  // ========================================
  // PIPECAT BOT TOOLS (AUTO-GENERATED)
  // From apps/pipecat-daily-bot @bot_tool decorators
  // ========================================
  ...BOT_TOOL_NAMES
] as const;

/**
 * Type representing any valid tool name
 */
export type RegisteredToolName = typeof ALL_REGISTERED_TOOLS[number];

/**
 * Get all registered tool names
 */
export function getAllRegisteredTools(): readonly RegisteredToolName[] {
  return ALL_REGISTERED_TOOLS;
}

/**
 * Get only bot tool names (tools prefixed with bot_)
 */
export function getBotToolNames(): readonly string[] {
  return BOT_TOOL_NAMES;
}

/**
 * Get tools by feature flag (bot tools only)
 * @param feature Feature flag name (e.g., "notes", "view", "window")
 */
export function getBotToolsByFeature(feature: string): readonly string[] {
  const byFeature = manifest.by_feature as Record<string, string[]>;
  return byFeature[feature] || [];
}

/**
 * Get all bot tool feature flags
 */
export function getBotToolFeatures(): readonly string[] {
  return manifest.features;
}

/**
 * Check if a tool name is a valid bot tool
 */
export function isBotTool(toolName: string): boolean {
  return BOT_TOOL_NAMES.includes(toolName);
}

/**
 * Get metadata for a specific bot tool
 */
export function getBotToolMetadata(toolName: string) {
  const tools = manifest.tools as Record<string, unknown>;
  return tools[toolName];
}

/**
 * Get manifest metadata (generation time, counts, etc.)
 */
export function getManifestMetadata() {
  return {
    version: manifest.version,
    toolCount: manifest.tool_count,
    featureCount: manifest.feature_count
  };
}
