/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';

import { createTwoFilesPatch } from 'diff';

import { Prism } from '../../prism';
import { PersonalityBlock } from '../blocks';

export type PersonalityModel = PersonalityBlock.IPersonality;
export type PersonalityHistoryEntry = PersonalityBlock.IPersonalityHistoryEntry;

// --- Helpers ---------------------------------------------------------------
/**
 * Generate a unified diff between two personality states
 */
function generatePersonalityDiff(oldPersonality: PersonalityModel, newPersonality: PersonalityModel, personalityId: string): string {
  // Create serialized versions for diff
  const oldContent = JSON.stringify(oldPersonality, null, 2);
  const newContent = JSON.stringify(newPersonality, null, 2);
  
  const patch = createTwoFilesPatch(
    `personality-${personalityId}.old.json`,
    `personality-${personalityId}.new.json`,
    oldContent,
    newContent,
    'Previous version',
    'Current version'
  );
  return patch;
}
function sanitizeVariables(vars?: string[]): PersonalityBlock.PersonalityVariable[] | undefined {
  if (!Array.isArray(vars)) return undefined;
  return vars.filter(v => (PersonalityBlock.PersonalityVariableValues as readonly string[]).includes(v)) as any;
}

// Sanitize and validate beats array
function sanitizeBeats(beats?: any): PersonalityBlock.IPersonalityBeat[] | undefined {
  if (!Array.isArray(beats)) return undefined;
  return beats
    .filter((beat: any) => {
      // Filter out invalid beats
      if (!beat || typeof beat !== 'object') return false;
      if (typeof beat.message !== 'string' || beat.message.trim() === '') return false;
      if (typeof beat.start_time !== 'number' || beat.start_time < 0) return false;
      return true;
    })
    .map((beat: any) => ({
      message: beat.message.trim(),
      start_time: Math.max(0, beat.start_time)
    }))
    .sort((a, b) => a.start_time - b.start_time); // Sort by start_time
}

// Ensure uniqueness of name among personalities in a tenant; returns a unique variant if conflict
export async function ensureUniqueName(tenantId: string, desired: string, excludeId?: string): Promise<string> {
  const existing = await listPersonalities(tenantId);
  const lower = (n: string) => n.trim().toLowerCase();
  if (!existing.some(p => p._id !== excludeId && p.name && lower(p.name) === lower(desired))) return desired;
  // append incrementing numeric suffix
  const base = desired.replace(/ \d+$/, '');
  let n = 1;
  let candidate = `${base} ${n}`;
  while (existing.some(p => p._id !== excludeId && p.name && lower(p.name) === lower(candidate))) {
    n += 1;
    candidate = `${base} ${n}`;
  }
  return candidate;
}

// Clone name heuristics mirroring client logic
export async function generateCloneName(sourceName: string): Promise<string> {
  const personalities = await listAllPersonalities();
  const allNames = personalities.map(p => (p.name || '').trim()).filter(Boolean) as string[];
  const exists = (n: string) => allNames.some(x => x.toLowerCase() === n.trim().toLowerCase());
  const trimmed = (sourceName || '').trim();
  if (!trimmed) {
    const base = 'New Personality';
    let n = 1; let candidate = `${base} ${n}`;
    while (exists(candidate)) { n += 1; candidate = `${base} ${n}`; }
    return candidate;
  }
  const numericSuffixMatch = trimmed.match(/^(.*\S)\s+(\d+(?:\.\d+)*)$/);
  if (numericSuffixMatch) {
    const parent = trimmed;
    const esc = parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const childRegex = new RegExp('^' + esc + '\\.(\\d+)$', 'i');
    let maxChild = 0;
    for (const n of allNames) {
      const m = n.match(childRegex); if (m) { const k = parseInt(m[1], 10); if (!Number.isNaN(k)) maxChild = Math.max(maxChild, k); }
    }
    let candidate = `${parent}.${maxChild + 1}`;
    while (exists(candidate)) { maxChild += 1; candidate = `${parent}.${maxChild}`; }
    return candidate;
  }
  const base = trimmed;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sibRegex = new RegExp('^' + esc + ' (\\d+)$', 'i');
  let maxIdx = 0;
  for (const n of allNames) { const m = n.match(sibRegex); if (m) { const k = parseInt(m[1], 10); if (!Number.isNaN(k)) maxIdx = Math.max(maxIdx, k); } }
  let candidate = `${base} ${maxIdx + 1}`;
  while (exists(candidate)) { maxIdx += 1; candidate = `${base} ${maxIdx}`; }
  return candidate;
}

// --- CRUD ------------------------------------------------------------------
export async function getPersonalityById(id: string): Promise<PersonalityModel | undefined> {
  const prism = await Prism.getInstance();
  const res = await prism.query({ contentType: 'Personality', tenantId: 'any', where: { page_id: id } });
  if (!res || res.total === 0) return undefined;
  const raw = res.items[0] as any;
  if (raw && Array.isArray(raw.variables)) raw.variables = sanitizeVariables(raw.variables);
  return raw as PersonalityModel;
}

export async function getPersonalityByName(name: string): Promise<PersonalityModel | undefined> {
  const prism = await Prism.getInstance();
  const res = await prism.query({ contentType: 'Personality', tenantId: 'any', where: { indexer: { path: 'name', equals: name } } });
  if (!res || res.total === 0) return undefined;
  const raw = res.items[0] as any;
  if (raw && Array.isArray(raw.variables)) raw.variables = sanitizeVariables(raw.variables);
  return raw as PersonalityModel;
}


export async function listPersonalities(tenantId: string): Promise<PersonalityModel[]> {
  const prism = await Prism.getInstance();
  const res = await prism.query({ contentType: 'Personality', tenantId: 'any', where: { parent_id: tenantId } });

  if (!res || !res.total) return [];
  return res.items.map(it => {
    if (Array.isArray((it as any).variables)) (it as any).variables = sanitizeVariables((it as any).variables);
    return it as PersonalityModel;
  });
}

export async function listAllPersonalities(): Promise<PersonalityModel[]> {
  const prism = await Prism.getInstance();
  const res = await prism.query({ contentType: 'Personality', tenantId: 'any', where: {} });
  if (!res || !res.total) return [];
  return res.items.map(it => {
    if (Array.isArray((it as any).variables)) (it as any).variables = sanitizeVariables((it as any).variables);
    return it as PersonalityModel;
  });
}

export interface CreatePersonalityInput {
  name?: string;
  description?: string;
  primaryPrompt?: string;
  variables?: string[];
  beats?: PersonalityBlock.IPersonalityBeat[];
}

export async function createPersonality(tenantId: string, input: CreatePersonalityInput): Promise<PersonalityModel> {
  const prism = await Prism.getInstance();
  const primaryPrompt = input.primaryPrompt || 'You are a helpful assistant.';
  const variables = sanitizeVariables(input.variables);
  const beats = sanitizeBeats((input as any).beats) as any;
  // Server-side name uniqueness enforcement (reject duplicates instead of auto-renaming)
  if (input.name) {
    const result = await prism.query({ contentType: 'Personality', tenantId: 'any', where: { indexer: { path: 'name', equals: input.name } } });
    if (result && result.total > 0) {
      const err: any = new Error('Personality name already exists');
      err.code = 'NAME_CONFLICT';
      throw err;
    }
  }
  const now = new Date().toISOString();
  const record: PersonalityModel = {
    key: randomUUID(),
    name: input.name ?? `Personality ${Date.now()}`,
    description: input.description || 'A Nia Assistant Personality',
    primaryPrompt,
    variables,
    beats: beats as any,
    tenantId,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
  const created = await prism.create('Personality', record, tenantId);
  if (!created || created.total === 0) throw new Error('Failed to create personality');
  const raw = created.items[0] as any;
  if (raw && Array.isArray(raw.variables)) raw.variables = sanitizeVariables(raw.variables);
  if (raw) raw.beats = sanitizeBeats(raw.beats) as any;
  return raw as PersonalityModel;
}

export async function updatePersonality(
  tenantId: string,
  id: string,
  patch: Partial<PersonalityModel>,
  lastModifiedByUserId?: string
): Promise<PersonalityModel | undefined> {
  const prism = await Prism.getInstance();
  if (patch.name) {
    const existing = await listAllPersonalities();
    const lower = patch.name.trim().toLowerCase();
    if (existing.some(p => p._id !== id && p.name && p.name.trim().toLowerCase() === lower)) {
      const err: any = new Error('Personality name already exists');
      err.code = 'NAME_CONFLICT';
      throw err;
    }
  }
  if (patch.variables) patch.variables = sanitizeVariables(patch.variables as any) as any;
  if ((patch as any).beats) (patch as any).beats = sanitizeBeats((patch as any).beats) as any;
  // Fetch existing record so we can build a full object for indexer construction
  const current = await getPersonalityById(id);
  if (!current) return undefined;
  // If the tenant is changing, we must set NotionModel.parent_id to the new tenant
  const requestedTenantId = (patch as any).tenantId as string | undefined;
  const movingTenant = requestedTenantId && requestedTenantId !== current.tenantId ? requestedTenantId : undefined;
  // Preserve immutable fields and merge patch
  const merged: PersonalityModel = {
    ...current,
    ...patch,
    _id: current._id, // ensure id intact
    tenantId: movingTenant ?? current.tenantId, // update content tenant when moving
  };
  
  // Generate diff and append to history
  const delta = generatePersonalityDiff(current, merged, id);
  const historyEntry: PersonalityHistoryEntry = {
    userId: lastModifiedByUserId || 'system',
    delta,
    modifiedAt: new Date().toISOString()
  };
  const updatedHistory = [...(current.history || []), historyEntry];
  
  // Include parent_id in the update payload if moving tenants
  const payload: any = movingTenant 
    ? { ...merged, parent_id: movingTenant, lastModifiedByUserId, history: updatedHistory, updatedAt: new Date().toISOString() } 
    : { ...merged, lastModifiedByUserId, history: updatedHistory, updatedAt: new Date().toISOString() };
  // Use the current tenant for the lookup/update call to reliably find the record,
  // even if the request's tenantId differs (we're moving to a new tenant).
  const updated = await prism.update('Personality', id, payload as any, current.tenantId);
  if (!updated || updated.total === 0) return undefined;
  const raw = updated.items[0] as any;
  if (raw && Array.isArray(raw.variables)) raw.variables = sanitizeVariables(raw.variables);
  if (raw) raw.beats = sanitizeBeats(raw.beats) as any;
  return raw as PersonalityModel;
}

export async function deletePersonality(tenantId: string, id: string): Promise<boolean> {
  const prism = await Prism.getInstance();
  return prism.delete('Personality', id, tenantId);
}

export async function clonePersonality(tenantId: string, id: string): Promise<PersonalityModel> {
  const source = await getPersonalityById(id);
  if (!source) throw new Error('Source personality not found');
  const newName = await generateCloneName(source.name || '');
  return createPersonality(tenantId, {
    name: newName,
    description: source.description || 'Cloned personality',
    primaryPrompt: source.primaryPrompt,
    variables: source.variables,
  });
}

