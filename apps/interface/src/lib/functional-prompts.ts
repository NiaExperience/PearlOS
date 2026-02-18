/**
 * Server-side utility for composing functional prompts with database support
 * This wraps the base composeFunctionalPrompt from @nia/features with database-first logic
 */

import { FeatureKey } from '@nia/features';
import { FunctionalPromptActions } from '@nia/prism';
import { getLogger } from './logger';

interface IFunctionalPrompt {
  _id: string;
  featureKey: string;
  promptContent: string;
}

/**
 * Compose functional prompts for enabled features from database only.
 * No fallback to hardcoded prompts - prompts must exist in database.
 * 
 * @param enabledFeatures - Array of feature keys that are enabled
 * @returns Composed prompt string from database entries only
 */
export async function composeFunctionalPromptWithDB(enabledFeatures: FeatureKey[]): Promise<string> {
  const log = getLogger('[functional-prompts]');
  let prompt = '';

  try {
    // Fetch all functional prompts from database
    const result = await FunctionalPromptActions.listAll(1000);
    const dbPrompts: IFunctionalPrompt[] = (result.items || []) as IFunctionalPrompt[];
    
    // Build a map of featureKey -> promptContent from database
    const dbPromptMap = new Map<string, string>();
    dbPrompts.forEach((p) => {
      if (p.featureKey && p.promptContent) {
        dbPromptMap.set(p.featureKey, p.promptContent);
      }
    });
    
    const debugEnabled = process.env.DEBUG_FUNCTIONAL_PROMPTS === 'true';
    if (debugEnabled) {
      log.info('Loaded functional prompts from database', { promptCount: dbPromptMap.size });
    }
    
    // Add prompts for enabled features (database only - no fallback)
    for (const feature of enabledFeatures) {
      if (dbPromptMap.has(feature)) {
        if (debugEnabled) {
          log.info('Using database prompt for feature', { feature });
        }
        prompt += dbPromptMap.get(feature) + '\n\n';
      } else {
        if (debugEnabled) {
          log.warn('No database prompt found for feature; skipping', { feature });
        }
      }
    }
    
    // Add built-in prompts (like desktopSwitching) from database
    if (dbPromptMap.has('desktopSwitching')) {
      if (debugEnabled) {
        log.info('Using database prompt for built-in desktopSwitching');
      }
      prompt += dbPromptMap.get('desktopSwitching');
    } else {
      if (debugEnabled) {
        log.warn('No database prompt found for built-in desktopSwitching');
      }
    }
    
    return prompt.trim();
  } catch (error) {
    // Log error but return empty string (no hardcoded fallback)
    log.error('Error fetching functional prompts from database', { error });
    return '';
  }
}
