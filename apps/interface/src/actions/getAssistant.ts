// server-only
import 'server-only';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { FeatureKey, isFeatureEnabled } from '@nia/features';
import { AssistantActions, TenantActions } from '@nia/prism/core/actions';
import {
    getAssistantByName, getAssistantBySubDomain
} from '@nia/prism/core/actions/assistant-actions';
import { IAssistant } from '@nia/prism/core/blocks/assistant.block';
import { NextAuthOptions } from 'next-auth';

import {
  coerceFeatureKeyList,
} from '@interface/lib/assistant-feature-sync';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

/**
 * Retrieves the assistant configuration (supportedFeatures and metadata).
 * Note: Prompt composition is handled by pipecat-daily-bot, not the interface.
 *
 * @param subDomain - The subdomain identifier for the assistant.
 * @param _clientLanguage - Unused, kept for backwards compatibility.
 * @param _userName - Unused, kept for backwards compatibility.
 * @param _userProfile - Unused, kept for backwards compatibility.
 * @param _sessionHistory - Unused, kept for backwards compatibility.
 * @returns A promise resolving to supportedFeatures and assistant metadata.
 */
export const getAssistantConfig = async (
  subDomain: string,
  _clientLanguage: string = 'en',
  _userName: string,
  _userProfile: Record<string, any> = {},
  _sessionHistory: Array<any> = []
): Promise<{ supportedFeatures: FeatureKey[] }> => {
  const log = getLogger('getAssistant');
  log.info('Fetching assistant config', { subDomain });

  // Normalize name for name-based lookup: capitalize first letter, lowercase the rest
  const normalizedName = subDomain ? subDomain.charAt(0).toUpperCase() + subDomain.slice(1).toLowerCase() : subDomain;
  let assistant = await getAssistantBySubDomain(subDomain) || await getAssistantByName(normalizedName);
  
  // If no assistant is found, find or create a default assistant configuration
  if (!assistant || !assistant._id) {
    log.warn('No assistant found, using default', { subDomain });
    assistant = await getDefaultAssistant(interfaceAuthOptions);
  } else if (!assistant.subDomain) {
    log.warn('Assistant has no subDomain', { id: assistant._id });
  }

  const supportedFeatures = coerceFeatureKeyList((assistant.supportedFeatures as unknown) ?? []);
  // Hardwire openclawBridge — bypass fragile feature flag chain
  if (!supportedFeatures.includes('openclawBridge')) {
    supportedFeatures.push('openclawBridge' as FeatureKey);
  }
  // Hardwire wonderCanvas feature flag
  if (!supportedFeatures.includes('wonderCanvas' as FeatureKey)) {
    supportedFeatures.push('wonderCanvas' as FeatureKey);
  }
  // Hardwire summonSpriteTool — sprite generation via ComfyUI
  if (!supportedFeatures.includes('summonSpriteTool' as FeatureKey)) {
    supportedFeatures.push('summonSpriteTool' as FeatureKey);
  }
  // Hardwire summonSpriteTool feature flag
  if (!supportedFeatures.includes('summonSpriteTool' as FeatureKey)) {
    supportedFeatures.push('summonSpriteTool' as FeatureKey);
  }
  // Hardwire desktop app icons so they always appear (especially in chat/touch mode)
  for (const feat of ['notes', 'htmlContent', 'miniBrowser', 'youtube', 'dailyCall'] as FeatureKey[]) {
    if (!supportedFeatures.includes(feat)) {
      supportedFeatures.push(feat);
    }
  }
  return {
    supportedFeatures,
  };
};

async function getDefaultAssistant(authOptions: NextAuthOptions): Promise<IAssistant> {
  const defaultSubDomain = 'nia';
  let assistant = await getAssistantBySubDomain(defaultSubDomain) || await getAssistantByName('Nia');
  if (!assistant) {
    // If the default assistant is also not found, create & persist one
    const log = getLogger('getAssistant');
    log.warn('Default assistant not found');
    const assistantData = {
      name: 'Nia',
      subDomain: defaultSubDomain,
    };
    const tenantId = await TenantActions.findOrCreateTenantForAssistant(assistantData, authOptions);
    log.info('Creating default assistant', { defaultSubDomain });
    assistant = await AssistantActions.createAssistant({ ...assistantData, tenantId });
    const updateData = {
      ...assistant,
      model: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'You are a helpful assistant.',
      },
    };
    log.info('Updating assistant with default configuration', { defaultSubDomain });
    await AssistantActions.updateAssistant(assistant._id!, updateData);
  }
  return assistant;
}
