'use server';

import { Prism } from '../../prism';
import {
  BlockType_GlobalSettings,
  DefaultGlobalSettings,
  DefaultInterfaceLoginSettings,
  GLOBAL_SETTINGS_SINGLETON_KEY,
  GlobalSettingsSchema,
  IGlobalSettings,
  InterfaceLoginSettings,
} from '../blocks/globalSettings.block';
import { getLogger } from '../logger';
import { GlobalSettingsDefinition } from '../platform-definitions';
import { PrismContentQuery } from '../types';

const log = getLogger('prism:actions:global-settings');

async function createGlobalSettingsDefinition() {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(GlobalSettingsDefinition);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create GlobalSettings definition');
  }
  return created.items[0];
}

async function ensureGlobalSettingsDefinition<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = `Content definition for type "${BlockType_GlobalSettings}" not found.`;
    if (error instanceof Error && error.message.includes(message)) {
      await createGlobalSettingsDefinition();
      return await operation();
    }
    throw error;
  }
}

function mergeWithDefaults(raw?: Partial<IGlobalSettings> | null): IGlobalSettings {
  const mergedInterfaceLogin: InterfaceLoginSettings = {
    ...DefaultInterfaceLoginSettings,
    ...(raw?.interfaceLogin ?? {}),
  };
  const mergedDenyListEmails = Array.isArray(raw?.denyListEmails) ? raw.denyListEmails : [];
  const merged: IGlobalSettings = {
    ...DefaultGlobalSettings,
    ...raw,
    singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
    interfaceLogin: mergedInterfaceLogin,
    denyListEmails: mergedDenyListEmails,
  };
  const parsed = GlobalSettingsSchema.safeParse(merged);
  if (parsed.success) {
    return parsed.data;
  }
  log.warn('Failed to validate settings, falling back to defaults', { error: parsed.error.format() });
  return DefaultGlobalSettings;
}

async function queryGlobalSettings(prism: Prism): Promise<IGlobalSettings | null> {
  const query: PrismContentQuery = {
    contentType: BlockType_GlobalSettings,
    tenantId: 'any',
    where: {
      type: { eq: BlockType_GlobalSettings },
      indexer: { path: 'singletonKey', equals: GLOBAL_SETTINGS_SINGLETON_KEY },
    },
    limit: 1,
  };

  const result = await ensureGlobalSettingsDefinition(() => prism.query(query));
  if (result && result.total > 0 && result.items.length > 0) {
    return mergeWithDefaults(result.items[0] as Partial<IGlobalSettings>);
  }
  return null;
}

export async function getGlobalSettings(): Promise<IGlobalSettings> {
  const prism = await Prism.getInstance();
  const existing = await queryGlobalSettings(prism);
  if (existing) {
    return existing;
  }
  // Create a default record to persist the singleton for future requests
  return await upsertGlobalSettings({});
}

export interface UpdateGlobalSettingsInput {
  interfaceLogin?: Partial<InterfaceLoginSettings>;
  denyListEmails?: string[];
}

/** @deprecated Use UpdateGlobalSettingsInput instead */
export interface UpdateInterfaceLoginSettingsInput extends Partial<InterfaceLoginSettings> {}

export async function upsertGlobalSettings(update: UpdateGlobalSettingsInput | UpdateInterfaceLoginSettingsInput): Promise<IGlobalSettings> {
  const prism = await Prism.getInstance();
  const existing = await queryGlobalSettings(prism);
  
  // Normalize input: support both new shape { interfaceLogin, denyListEmails } and legacy flat shape
  const hasNewShape = 'interfaceLogin' in update || 'denyListEmails' in update;
  const interfaceLoginUpdate = hasNewShape 
    ? (update as UpdateGlobalSettingsInput).interfaceLogin ?? {}
    : update as Partial<InterfaceLoginSettings>;
  const denyListEmailsUpdate = hasNewShape
    ? (update as UpdateGlobalSettingsInput).denyListEmails
    : undefined;

  // For nested interfaceLogin settings, we need to merge at client level first
  // to handle defaults properly, then use atomic merge for the top-level update
  const mergedInterfaceLogin: InterfaceLoginSettings = {
    ...DefaultInterfaceLoginSettings,
    ...(existing?.interfaceLogin ?? {}),
    ...interfaceLoginUpdate,
  };

  // For denyListEmails, only update if explicitly provided
  const mergedDenyListEmails = denyListEmailsUpdate !== undefined
    ? denyListEmailsUpdate
    : (existing?.denyListEmails ?? []);

  if (existing && existing._id) {
    // Use atomic merge - only send the fields being updated
    const updatePayload: Partial<IGlobalSettings> = {
      interfaceLogin: mergedInterfaceLogin,
      denyListEmails: mergedDenyListEmails,
      singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
    };
    const updated = await prism.update(BlockType_GlobalSettings, existing._id, updatePayload, 'any');
    if (!updated || updated.total === 0 || updated.items.length === 0) {
      throw new Error('Failed to update GlobalSettings record');
    }
    return mergeWithDefaults(updated.items[0] as Partial<IGlobalSettings>);
  }

  const createPayload: IGlobalSettings = {
    ...DefaultGlobalSettings,
    interfaceLogin: mergedInterfaceLogin,
    denyListEmails: mergedDenyListEmails,
  };
  const created = await ensureGlobalSettingsDefinition(() => prism.create(BlockType_GlobalSettings, createPayload, 'any'));
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create GlobalSettings record');
  }
  return mergeWithDefaults(created.items[0] as Partial<IGlobalSettings>);
}

/**
 * Checks if an email address is in the global deny list.
 * Returns true if the email is denied (should be blocked), false otherwise.
 * Comparison is case-insensitive.
 */
export async function isEmailDenied(email: string | null | undefined): Promise<boolean> {
  if (!email) {
    return false; // No email to check
  }
  try {
    const globalSettings = await getGlobalSettings();
    const denyList = globalSettings?.denyListEmails || [];
    const normalizedEmail = email.toLowerCase();
    const isDenied = denyList.some((deniedEmail: string) => deniedEmail.toLowerCase() === normalizedEmail);
    if (isDenied) {
      log.warn('Email found in deny list', { email });
    }
    return isDenied;
  } catch (error) {
    // Log but don't block if we can't check the deny list
    log.warn('Failed to check email deny list', { error, email });
    return false;
  }
}
