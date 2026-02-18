/**
 * System prompt composition utilities
 * 
 * All functional prompts are now stored in the database.
 * Use composeFunctionalPromptWithDB from @interface/lib/functional-prompts for production.
 * Dashboard uses composeFunctionalPromptFromDB in assistant-model-tab.tsx for preview.
 */

import { getLogger } from './logger';

// Import tool registry (auto-generated from @bot_tool decorators)
export { 
  ALL_REGISTERED_TOOLS,
  getAllRegisteredTools,
  getBotToolNames,
  getBotToolsByFeature,
  getBotToolFeatures,
  isBotTool,
  getBotToolMetadata,
  getManifestMetadata,
  type RegisteredToolName
} from './botToolsRegistry';

// Re-export for backward compatibility
export type { RegisteredToolName as ToolName } from './botToolsRegistry';

// Use canonical model: NOTE, these are COPIED from prism/src/blocks/personality.block.ts
const PersonalityVariableValues = ['username','roomName','topic'] as const;
type PersonalityVariable = typeof PersonalityVariableValues[number];
interface IPersonalityEventResponse { text: string; }
interface IPersonalityEventPrompt { event: string; response: IPersonalityEventResponse; }

export type PersonalityModel = {
  _id?: string;
  name?: string;
  description?: string;
  primaryPrompt: string;
  variables?: PersonalityVariable[];
  tenantId: string;
  version?: number;
};

export type TemplateVars = { 
  username?: string; 
  roomName?: string; 
  topic?: string; 
  userProfile?: Record<string, string>;
  sessionHistory?: Array<{
    time: string;
    action: string;
    sessionId: string;
    refIds?: Array<{ type: string; id: string; description?: string }>;
  }>;
};

export function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{([^}|]+)(?:\|([^}]+))?\}\}/g, (_, key: string, def?: string) => {
    const k = key.trim() as keyof TemplateVars;
    const val = vars[k];
    return (val ?? def ?? '').toString();
  });
}

export function composeSystemPrompt(personality: PersonalityModel, vars: TemplateVars = {}): string {
  const primaryPersonality = interpolate(personality.primaryPrompt || '', vars);
  const pp = primaryPersonality ? "==== BEGIN PRIMARY PERSONALITY PROMPT ====\n" + primaryPersonality + "\n==== END PRIMARY PERSONALITY PRIMARY PROMPT ====" : '';
  // if the vars contains a username, add a note to tell the Assistant the user's name
  return pp
}

export function composeUserPrompt(vars: TemplateVars = {}): string {
  const logger = getLogger('features:prompts');
  // Helper to format ISO timestamp to readable string
  const formatTimestamp = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      // Recent activity - show relative time
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
      if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
      
      // Older activity - show date and time
      return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
    } catch {
      return isoString; // Fallback to original if parsing fails
    }
  };

  // if the vars contains a username, add a note to tell the Assistant the user's name
  const userNamePrompt = (vars.username) ? `The user's name is "${vars.username}". You should refer to them by their first name.\n` : '';
  let userProfilePrompt = undefined;
  if (vars.userProfile) {
    // Helper to serialize values to YAML-friendly format
    const serializeValue = (v: unknown): string => {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (Array.isArray(v)) {
        // Format arrays in YAML style
        if (v.length === 0) return '[]';
        return '\n' + v.map((item) => `    - ${serializeValue(item)}`).join('\n');
      }
      if (typeof v === 'object') {
        // Format objects in YAML style
        try {
          const entries = Object.entries(v);
          if (entries.length === 0) return '{}';
          return '\n' + entries.map(([key, val]) => `    ${key}: ${serializeValue(val)}`).join('\n');
        } catch {
          return String(v);
        }
      }
      return String(v);
    };

    const profileEntries = Object.entries(vars.userProfile).map(([k, v]) => `- ${k.replaceAll('_', ' ')} = ${serializeValue(v)}`).join('\n');
    if (profileEntries.length > 0) {
      userProfilePrompt = `The user's profile information follows. Use this information to continue the last conversation and continue to personalize your responses and update the user profile.\n${profileEntries}\n`;
    }
  }
  
  // Add session history if available
  let sessionHistoryPrompt = '';
  if (vars.sessionHistory && Array.isArray(vars.sessionHistory) && vars.sessionHistory.length > 0) {
    // filter the sessionHistory items older than 2 days
    const filteredHistory = vars.sessionHistory.filter(entry => {
      try {
        const entryDate = new Date(entry.time);
        const now = new Date();
        const diffMs = now.getTime() - entryDate.getTime();
        const diffDays = Math.floor(diffMs / 86400000);
        return diffDays <= 2; // keep entries within last 2 days
      } catch {
        return false; // if parsing fails, exclude the entry
      }
    });
    // Now limit the history to the most recent 20 entries
    filteredHistory.sort((a, b) => {
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });
    if (filteredHistory.length > 20) {
      filteredHistory.splice(20);
    }
    // If all entries were filtered out due to date, but we do have history, keep the most recent one
    if (filteredHistory.length === 0 && vars.sessionHistory.length > 0) {
      // if all entries were filtered out but there were some, keep the most recent one
      logger.info('Session history filtered; keeping most recent entry', {
        totalEntries: vars.sessionHistory.length,
      });
      filteredHistory.push(vars.sessionHistory.reduce((a, b) => {
        return new Date(a.time) > new Date(b.time) ? a : b;
      }));
    }
    const historyLines = filteredHistory.map((entry, _: number) => {
      const timeStr = formatTimestamp(entry.time);
      let line = `- Recent activity ${timeStr}: ${entry.action}`;
      if (entry.refIds && entry.refIds.length > 0) {
        const refs = entry.refIds.map((ref) => {
          return `${ref.type} ID: ${ref.id}${ref.description ? `, ${ref.description}` : ''}`;
        }).join(', ');
        line += `, ${refs}`;
      }
      return line;
    });

    sessionHistoryPrompt = historyLines.join('\n');
  }
  
  return userNamePrompt || userProfilePrompt || sessionHistoryPrompt ? "\n" + (userNamePrompt || '') + (userProfilePrompt || '') + sessionHistoryPrompt + "\n" : '';
}
