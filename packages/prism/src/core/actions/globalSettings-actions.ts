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

function normalizeEmailList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function mergeWithDefaults(raw?: Partial<IGlobalSettings> | null): IGlobalSettings {
  const mergedInterfaceLogin: InterfaceLoginSettings = {
    ...DefaultInterfaceLoginSettings,
    ...(raw?.interfaceLogin ?? {}),
  };
  const mergedDenyListEmails = Array.isArray(raw?.denyListEmails) ? raw.denyListEmails : [];
  const mergedAllowListEmails = Array.isArray(raw?.allowListEmails) ? raw.allowListEmails : [];
  const merged: IGlobalSettings = {
    ...DefaultGlobalSettings,
    ...raw,
    singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
    interfaceLogin: mergedInterfaceLogin,
    denyListEmails: mergedDenyListEmails,
    allowListEmails: mergedAllowListEmails,
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
  allowListEmails?: string[];
}

/** @deprecated Use UpdateGlobalSettingsInput instead */
export interface UpdateInterfaceLoginSettingsInput extends Partial<InterfaceLoginSettings> {}

export async function upsertGlobalSettings(update: UpdateGlobalSettingsInput | UpdateInterfaceLoginSettingsInput): Promise<IGlobalSettings> {
  const prism = await Prism.getInstance();
  const existing = await queryGlobalSettings(prism);

  // Normalize input: support both new shape { interfaceLogin, denyListEmails, allowListEmails } and legacy flat shape
  const hasNewShape = 'interfaceLogin' in update || 'denyListEmails' in update || 'allowListEmails' in update;
  const interfaceLoginUpdate = hasNewShape
    ? (update as UpdateGlobalSettingsInput).interfaceLogin ?? {}
    : update as Partial<InterfaceLoginSettings>;
  const denyListEmailsUpdate = hasNewShape
    ? (update as UpdateGlobalSettingsInput).denyListEmails
    : undefined;
  const allowListEmailsUpdate = hasNewShape
    ? (update as UpdateGlobalSettingsInput).allowListEmails
    : undefined;

  // For nested interfaceLogin settings, we need to merge at client level first
  // to handle defaults properly, then use atomic merge for the top-level update
  const mergedInterfaceLogin: InterfaceLoginSettings = {
    ...DefaultInterfaceLoginSettings,
    ...(existing?.interfaceLogin ?? {}),
    ...interfaceLoginUpdate,
  };

  // For denyListEmails / allowListEmails, only update if explicitly provided.
  // Values are normalized (lowercased, deduped, trimmed) before persistence.
  const mergedDenyListEmails = denyListEmailsUpdate !== undefined
    ? normalizeEmailList(denyListEmailsUpdate)
    : (existing?.denyListEmails ?? []);

  const mergedAllowListEmails = allowListEmailsUpdate !== undefined
    ? normalizeEmailList(allowListEmailsUpdate)
    : (existing?.allowListEmails ?? []);

  if (existing && existing._id) {
    // Use atomic merge - only send the fields being updated
    const updatePayload: Partial<IGlobalSettings> = {
      interfaceLogin: mergedInterfaceLogin,
      denyListEmails: mergedDenyListEmails,
      allowListEmails: mergedAllowListEmails,
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
    allowListEmails: mergedAllowListEmails,
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

// ---------------------------------------------------------------------------
// Google sign-in allowlist (Postgres-backed)
// ---------------------------------------------------------------------------

/**
 * Returns the Postgres-stored Google sign-in allowlist (normalized, lowercase).
 * Returns an empty array if there is no allowlist configured in the DB.
 */
export async function getGoogleSignInAllowList(): Promise<string[]> {
  try {
    const globalSettings = await getGlobalSettings();
    return normalizeEmailList(globalSettings?.allowListEmails ?? []);
  } catch (error) {
    log.warn('Failed to read Google sign-in allowlist from global settings', { error });
    return [];
  }
}

/**
 * Checks whether an email is allowed to sign in via Google according to the
 * Postgres-stored allowlist. If the stored allowlist is empty, returns true
 * (no allowlist configured means no restriction from the DB side).
 */
export async function isGoogleSignInEmailAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const allow = await getGoogleSignInAllowList();
  if (allow.length === 0) return true;
  return allow.includes(email.trim().toLowerCase());
}

/**
 * Adds an email to the Google sign-in allowlist. No-op (but still returns the
 * current settings) if the email is already present. Returns the updated list.
 */
export async function addGoogleSignInAllowListEmail(email: string): Promise<string[]> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Email must be a non-empty string');
  }
  const current = await getGoogleSignInAllowList();
  if (current.includes(normalized)) {
    return current;
  }
  const next = [...current, normalized];
  const updated = await upsertGlobalSettings({ allowListEmails: next });
  return updated.allowListEmails;
}

/**
 * Removes an email from the Google sign-in allowlist. Returns the updated list.
 * If the email is not present, returns the current list unchanged.
 */
export async function removeGoogleSignInAllowListEmail(email: string): Promise<string[]> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Email must be a non-empty string');
  }
  const current = await getGoogleSignInAllowList();
  if (!current.includes(normalized)) {
    return current;
  }
  const next = current.filter((e) => e !== normalized);
  const updated = await upsertGlobalSettings({ allowListEmails: next });
  return updated.allowListEmails;
}

/**
 * Replaces one email with another in the Google sign-in allowlist. The old
 * email must be present; the new email replaces it at the same position.
 * Throws if `oldEmail` is not found, or if `newEmail` is already present
 * (to prevent silent duplicates).
 */
export async function updateGoogleSignInAllowListEmail(oldEmail: string, newEmail: string): Promise<string[]> {
  const fromNorm = String(oldEmail || '').trim().toLowerCase();
  const toNorm = String(newEmail || '').trim().toLowerCase();
  if (!fromNorm || !toNorm) {
    throw new Error('Both oldEmail and newEmail must be non-empty strings');
  }
  if (fromNorm === toNorm) {
    return await getGoogleSignInAllowList();
  }
  const current = await getGoogleSignInAllowList();
  const idx = current.indexOf(fromNorm);
  if (idx === -1) {
    throw new Error(`Email "${oldEmail}" is not in the Google sign-in allowlist`);
  }
  if (current.includes(toNorm)) {
    throw new Error(`Email "${newEmail}" is already in the Google sign-in allowlist`);
  }
  const next = [...current];
  next[idx] = toNorm;
  const updated = await upsertGlobalSettings({ allowListEmails: next });
  return updated.allowListEmails;
}

/**
 * Replaces the full Google sign-in allowlist with the given emails. Used by
 * the seed script (`--replace` mode). Returns the normalized list.
 */
export async function setGoogleSignInAllowList(emails: string[]): Promise<string[]> {
  const updated = await upsertGlobalSettings({ allowListEmails: emails });
  return updated.allowListEmails;
}
