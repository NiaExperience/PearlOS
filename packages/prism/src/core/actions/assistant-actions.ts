/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { Prism } from '../../prism';
import { AssistantFeedbackBlock } from '../blocks';
import { BlockType_Assistant, IAssistant } from '../blocks/assistant.block';
import { IDynamicContent } from '../blocks/dynamicContent.block';
import { ContentData } from '../content/types';
import { PrismContentQuery, PrismContentResult } from '../types';
import { handleError, isValidUUID, safeRevalidatePath } from '../utils';
import { getLogger } from '../logger';

import { getTenantsForUser } from './tenant-actions';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ejs = require('ejs');

const log = getLogger('prism:actions:assistant');

function migrateAssistantOnLoad(assistant: any): IAssistant {
  if (!assistant) return assistant;

  // Ensure modePersonalityVoiceConfig exists
  if (!assistant.modePersonalityVoiceConfig) {
    assistant.modePersonalityVoiceConfig = {};
  }

  // Check if default mode is missing
  if (!assistant.modePersonalityVoiceConfig['default']) {
    // Construct default mode from legacy root fields
    const legacyPersonalityId = assistant.personalityId;
    const legacyPersonaName = assistant.persona_name;
    const legacyVoice = assistant.voice;
    const legacyName = assistant.name;

    if (legacyPersonalityId || legacyVoice) {
       assistant.modePersonalityVoiceConfig['default'] = {
         room_name: 'Default Room',
         personalityId: legacyPersonalityId,
         personalityName: legacyName || 'Default Personality',
         personaName: legacyPersonaName || 'Assistant',
         voice: legacyVoice
       };
    }
  }
  
  return assistant as IAssistant;
}

// Get all assistants
export async function getAssistantIdBySubDomain(subDomain: string | null): Promise<string | undefined> {
  try {
    const assistant = await getAssistantBySubDomain(subDomain);
    if (!assistant) return undefined;
    return assistant._id as string;
  } catch (error) {
    log.error('Failed to resolve assistantId by subdomain', { subDomain, error });
  }
}

// Get an assistant by subDomain
export async function getAssistantBySubDomain(subDomain: string | null): Promise<IAssistant | null> {
  try {
    const prism = await Prism.getInstance();
    if (!subDomain) {
      log.warn('[getAssistantBySubDomain] subDomain must be provided', { subDomain });
      return null;
    }
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any', // Use 'any' to search across all tenants
      where: {
        indexer: { path: "subDomain", equals: subDomain },
      },
      orderBy: { createdAt: 'desc' } // Order by creation date, descending
    };

    const result: PrismContentResult = await prism.query(query);

    if (!result || result.total === 0) {
      log.debug('[getAssistantBySubDomain] cannot find subDomain block', { subDomain });
      return null;
    }
    if (result.total > 1) {
      throw new Error(`[getAssistantBySubDomain] Found ${result.total} assistants found for subDomain ${subDomain}!`);;
    }
    const assistant = result.items[0] as IAssistant;
    return migrateAssistantOnLoad(assistant);
  } catch (error) {
    log.error('Failed to fetch assistant by subdomain', { subDomain, error });
    return null;
  }
}

// Get an assistant by subDomain
export async function getAssistantByName(name: string | null): Promise<IAssistant | null> {
  try {
    const prism = await Prism.getInstance();
    if (!name) {
      log.warn('[getAssistantByName] name must be provided', { name });
      return null;
    }
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any', // Use 'any' to search across all tenants
      where: {
        indexer: { path: "name", equals: name },
      },
      orderBy: { createdAt: 'desc' } // Order by creation date, descending
    };

    const result: PrismContentResult = await prism.query(query);

    if (!result || result.total === 0) {
      return null;
    }
    if (result.total > 1) {
      throw new Error(`[getAssistantByName] Found ${result.total} assistants found for name ${name}!`);
    }
    const assistant = result.items[0] as IAssistant;
    return migrateAssistantOnLoad(assistant);
  } catch (error) {
    log.error('Failed to fetch assistant by name', { name, error });
    return null;
  }
}


export async function getValidatedAssistant(assistantId: string | null, assistantSubdomain: string | null) : Promise<IAssistant | null> {
  const prism = await Prism.getInstance();
  if (assistantId && isValidUUID(assistantId)) {
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any', // Use 'any' to search across all tenants
      where: { page_id: assistantId },
      orderBy: { createdAt: 'desc' } // Order by creation date, descending
    };
    const result = await prism.query(query);
    if (!result || result.total === 0) {
      log.warn('Assistant not found by id during validation', { assistantId });
      return null;
    }
    if (result.total > 1) {
      throw new Error(`Found ${result.total} assistants with ID ${assistantId}!`);
    }
    return migrateAssistantOnLoad(result.items[0]);
  }
  // If agent/subdomain is provided
  return await getAssistantBySubDomain(assistantSubdomain);
}
export async function getValidatedAssistantId(assistantId: string | null, assistantSubdomain: string | null) {
  // If assistant_id is provided directly
  if (assistantId && isValidUUID(assistantId)) {
    return assistantId;
  }
  // If agent/subdomain is provided
  else {
    return await getAssistantIdBySubDomain(assistantSubdomain);
  }
}


// Add this custom error class at the top of the file
class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Create Assistant Input Type
export type CreateAssistantParams = {
  name: string;
  tenantId: string;
  subDomain?: string;
  persona_name?: string;
};

// Update Assistant Input Type
export type UpdateAssistantParams = {
  name?: string;
  subDomain?: string;
  tenantId?: string;
  [key: string]: any;
};

// Create a new assistant
export async function createAssistant(assistantData: CreateAssistantParams): Promise<IAssistant> {
  try {
    const prism = await Prism.getInstance();
    // make sure there are no existing assistants with the same name
    if (!assistantData.name || !assistantData.tenantId) {
      throw new APIError('Name and Tenant ID are required', 400);
    }
    
    // Check for duplicate name within the same tenant
    const existingByName = await prism.query({
      contentType: BlockType_Assistant,
      tenantId: assistantData.tenantId,
      where: {
        indexer: { path: "name", equals: assistantData.name },
      },
    });
    
    if (existingByName && existingByName.total > 0) {
      throw new APIError('An assistant with this name already exists', 409);
    }
    
    if (!assistantData.subDomain) {
      let subDomain = assistantData.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      // If generated subDomain would be "pearl", change it to "pearlos"
      if (subDomain === 'pearl') {
        subDomain = 'pearlos';
      }
      assistantData.subDomain = subDomain;
    }
    
    // Also check for duplicate subdomain
    const existingBySubDomain = await getAssistantBySubDomain(assistantData.subDomain);
    if (existingBySubDomain) {
      throw new APIError('An assistant with this subdomain already exists', 409);
    }
    const created = await prism.create(BlockType_Assistant, assistantData, assistantData.tenantId);
    if (!created || created.total === 0 || created.items.length === 0) {
      throw new APIError('Failed to create assistant', 500);
    }

    safeRevalidatePath('/assistants');
    return migrateAssistantOnLoad(created.items[0] as unknown as IAssistant);

  } catch (error) {
    // Check for error
    log.error('Error creating assistant', { error, assistantData });
    if (error instanceof Error && 'code' in error && (error as any).code === 11000) {
      throw new APIError('Assistant name must be unique', 409);
    }

    if (error instanceof APIError) {
      throw error;
    }

    throw new APIError('Internal Server Error', 500);
  }
}

// Get all assistants for a specific tenant
export async function getAllAssistants(tenantId: string, userId: string): Promise<IAssistant[] | undefined> {
  try {
    if (!userId || !tenantId) {
      log.error('[getAllAssistants] userId and tenantId must be provided', { tenantId, userId });
      throw new APIError('Unauthorized', 401);
    }
    const prism = await Prism.getInstance();
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any',
      where: {},
      orderBy: { createdAt: 'desc' }, // Order by creation date, descending
      limit: 100, // Limit to 100 assistants
    };

    if (tenantId && tenantId !== 'any') {
      query.where!.parent_id = { eq: tenantId };
    }

    const result = await prism.query(query);
    if (!result || result.total === 0) {
      log.warn('No assistants found for tenant', { tenantId, userId });
      return [];
    }
    return result.items.map(migrateAssistantOnLoad);
  } catch (error) {
    // Only handle unexpected errors here. Let specific errors like Unauthorized propagate.
    if (error instanceof Error && (error.message === 'Unauthorized')) {
      throw error; // Re-throw the specific error
    }
    handleError(error);
    // Consider returning undefined or throwing a generic error after handling
  }
}

// List assistants for a tenant without user scoping (internal admin use)
export async function listAssistantsForTenant(tenantId: string): Promise<IAssistant[]> {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_Assistant,
    tenantId: 'any',
    where: { parent_id: { eq: tenantId } },
    limit: 500,
    orderBy: { createdAt: 'desc' }
  };
  const res = await prism.query(query);
  if (!res || !res.total) return [];
  return res.items.map(migrateAssistantOnLoad) as IAssistant[];
}

// Count assistants using a given personality within a tenant
export async function countAssistantsUsingPersonality(tenantId: string, personalityId: string): Promise<number> {
  const assistants = await listAssistantsForTenant(tenantId);
  return assistants.filter(a => (a as any).personalityId === personalityId).length;
}

// Get all assistants across all tenants the user has access to
export async function getAllAssistantsForUser(userId: string): Promise<IAssistant[] | undefined> {
  try {
    if (!userId) {
      log.error('[getAllAssistantsForUser] userId must be provided');
      throw new APIError('Unauthorized', 401);
    }
    // Get all tenants the user has access to
    const tenants = await getTenantsForUser(userId);
    if (!tenants || tenants.length === 0) {
      log.warn('No tenants found for user', { userId });
      return [];
    }
    log.info('[getAllAssistantsForUser] Found tenants for user', { userId, tenantCount: tenants.length });
    const prism = await Prism.getInstance();
    
    // Build OR query to fetch assistants from all user's tenants
    const tenantIds = tenants.map(tenant => tenant._id);
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any',
      where: {
        parent_id: { in: tenantIds }, // Use parent_id to filter by tenant ownership
      },
      orderBy: { createdAt: 'desc' }, // Order by creation date, descending
      limit: 500, // Higher limit since we're querying across multiple tenants
    };
    
    log.debug('[getAllAssistantsForUser] Querying assistants for tenants', { userId, tenantIds, query });
    const result = await prism.query(query);
    if (!result || result.total === 0) {
      log.warn('No assistants found across user tenants', { userId, tenantCount: tenants.length });
      return [];
    }
    log.info('[getAllAssistantsForUser] Assistants fetched for user', { userId, tenantCount: tenants.length, assistantCount: result.items.length });
    return result.items.map(migrateAssistantOnLoad);
  } catch (error) {
    // Only handle unexpected errors here. Let specific errors like Unauthorized propagate.
    if (error instanceof Error && (error.message === 'Unauthorized')) {
      throw error; // Re-throw the specific error
    }
    handleError(error);
    // Consider returning undefined or throwing a generic error after handling
  }
}

// Get assistant by ID
export async function getAssistantById(assistantId: string): Promise<IAssistant | null> {
  try {
    if (!assistantId) {
      throw new Error('Assistant ID is required');
    }
    // Defensive: avoid querying with a non-UUID (e.g., route segment like "users") which breaks pg uuid casts
    if (!isValidUUID(assistantId)) {
      log.warn('[getAssistantById] Ignoring non-UUID assistantId input', { assistantId });
      return null;
    }
    const prism = await Prism.getInstance();
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any',
      where: { page_id: assistantId },
      orderBy: { createdAt: 'desc' }, // Order by creation date, descending
    };
    const result = await prism.query(query);
    if (!result || result.total === 0 || !result.items || result.items.length === 0) {
      return null;
    }
    if (result.items.length > 1) {
      throw new Error(`Found ${result.total} assistants with ID ${assistantId}!: ${JSON.stringify(result.items)}`);
    }
    if (!result.items[0]) {
      log.error('Assistant with ID has no content', { assistantId });
    }
    return migrateAssistantOnLoad(result.items[0]);

  } catch (error) {
    // Re-throw specific expected errors
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Assistant not found')) {
      throw error;
    }
    throw handleError(error);
  }
}

// Update assistant
export async function updateAssistant(
  assistantId: string,
  assistantData: UpdateAssistantParams
): Promise<IAssistant | undefined> {
  try {
    const prism = await Prism.getInstance();
    
    // Build update payload - send updates directly, no fetch-and-merge
    const updateData: any = { ...assistantData };

    // Special case: If name is being updated, regenerate subDomain
    if (assistantData.name) {
      // Only fetch if we need to check if name actually changed
      const query: PrismContentQuery = {
        contentType: BlockType_Assistant,
        tenantId: 'any',
        where: { page_id: assistantId },
        orderBy: { createdAt: 'desc' },
      };
      const result = await prism.query(query);
      if (!result || result.total === 0) {
        throw new Error(`Assistant not found`);
      }
      if (result.total > 1) {
        throw new Error(`Found ${result.total} assistants with ID ${assistantId}!`);
      }
      const existingAssistant = result.items[0];
      
      // Only regenerate subDomain if name actually changed
      if (assistantData.name !== existingAssistant.name) {
        // Preserve "pearlos" subDomain - never change it to "pearl"
        const existingSubDomain = existingAssistant.subDomain;
        if (existingSubDomain === 'pearlos') {
          // Keep "pearlos" even if name changes
          updateData.subDomain = 'pearlos';
        } else {
          let subDomain = assistantData.name
            .toLowerCase()
            .trim()
            .replace(/[^a-z\s]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
          if (!subDomain) subDomain = 'assistant';
          // If generated subDomain would be "pearl", change it to "pearlos"
          if (subDomain === 'pearl') {
            subDomain = 'pearlos';
          }
          updateData.subDomain = subDomain; // allow uniqueness enforcement at persistence layer
        }
      }
      
      // Use existing tenantId for update
      const updated = await prism.update(BlockType_Assistant, assistantId, updateData, existingAssistant.tenantId);
      
      safeRevalidatePath('/assistants');
      safeRevalidatePath(`/assistants/${assistantId}`);
      
      return migrateAssistantOnLoad(updated.items[0] as unknown as IAssistant);
    }
    
    // No name update - direct update without fetch
    const updated = await prism.update(BlockType_Assistant, assistantId, updateData, 'any');

    safeRevalidatePath('/assistants');
    safeRevalidatePath(`/assistants/${assistantId}`);

    return migrateAssistantOnLoad(updated.items[0] as unknown as IAssistant);
  } catch (error) {
    // Re-throw specific expected errors
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Assistant not found')) {
      throw error;
    }
    handleError(error);
  }
}

// Delete assistant
export async function deleteAssistant(assistantId: string): Promise<IAssistant | undefined> {
  try {
    const prism = await Prism.getInstance();
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any',
      where: { page_id: assistantId },
      orderBy: { createdAt: 'desc' }, // Order by creation date, descending
    };
    const result = await prism.query(query);
    if (!result || result.total === 0) {
      throw new Error('Assistant not found');
    }
    const existingAssistant = result.items[0];
    // Modify query to ensure ownership - delete assistant only if _id and user match
    // findByIdAndDelete doesn't work this way. Use findOneAndDelete instead.
    const success = await prism.delete(BlockType_Assistant, assistantId, result.items[0].tenantId);
    if (!success) throw new Error('Assistant not found');

    safeRevalidatePath('/assistants');

    return existingAssistant;
  } catch (error) {
    // Re-throw specific expected errors
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Assistant not found')) {
      throw error;
    }
    handleError(error);
  }
}

// Clone Assistant Input Type
export type CloneAssistantParams = {
  newName: string;
  newSubdomain?: string;
  persona_name?: string;
  special_instructions?: string;
};

function handleSpecialCases(object: ContentData, modelType: string): ContentData {
  // TODO, we should put these in the Zod schema defaults (legacy-definitions.ts) instead of here
  if (modelType === 'Exhibitor') {
    // Add default for required 'location' field if missing
    if (!object.location || String(object.location).trim() === "") {
      log.warn('[cloneAssistant] Exhibitor missing location, defaulting', { originalId: object._id });
      object.location = 'TBA';
    }
    // Add default for required 'title' field if missing - schema says title: { type: String, required: true }
    if (!object.title || String(object.title).trim() === "") {
      log.warn('[cloneAssistant] Exhibitor missing title, defaulting', { originalId: object._id });
      object.title = 'Untitled Exhibitor';
    }
    // Add default for required 'tellMeMore' field if missing - schema says tellMeMore: { required: true, validate... }
    // Use a simple URL validation regex (no unnecessary escapes)
    const tellMeMoreUrlRegex = /^(https?:\/\/|ftp:\/\/)[^\s]+$/;
    if (!object.tellMeMore || String(object.tellMeMore).trim() === "") {
      log.warn('[cloneAssistant] Exhibitor missing tellMeMore URL, defaulting', { originalId: object._id });
      object.tellMeMore = 'https://example.com/placeholder';
    } else if (!tellMeMoreUrlRegex.test(String(object.tellMeMore).trim())) {
      log.warn('[cloneAssistant] Exhibitor invalid tellMeMore URL, defaulting', { originalId: object._id, tellMeMore: object.tellMeMore });
      object.tellMeMore = 'https://example.com/placeholder';
    }
  } else if (modelType === 'Agenda') {
    // Add default for required 'track' field if missing
    if (!object.track || String(object.track).trim() === "") {
      log.warn('[cloneAssistant] Agenda item missing track, defaulting', { originalId: object._id });
      object.track = 'General';
    }
    // Add default for required 'speaker' field if missing - schema says speaker: { type: String, required: true }
    if (!object.speaker || String(object.speaker).trim() === "") {
      log.warn('[cloneAssistant] Agenda item missing speaker, defaulting', { originalId: object._id });
      object.speaker = 'To Be Announced';
    }
  } else if (modelType === 'Speaker') {
    // Add default for required 'name' field if missing
    if (!object.name || String(object.name).trim() === "") {
      log.warn('[cloneAssistant] Speaker missing name, defaulting', { originalId: object._id });
      object.name = 'Unnamed Speaker';
    }
    // Add default for required 'photo' field if missing or invalid
    const photoUrlRegex = /^(http|https):\/\/[^ "]+$/;
    if (!object.photo || String(object.photo).trim() === "" || !photoUrlRegex.test(String(object.photo).trim())) {
      if (!object.photo || String(object.photo).trim() === "") {
        log.warn('[cloneAssistant] Speaker missing photo URL, defaulting', { originalId: object._id });
      } else {
        log.warn('[cloneAssistant] Speaker invalid photo URL, defaulting', { originalId: object._id, photo: object.photo });
      }
      object.photo = 'https://via.placeholder.com/150';
    }
  }
  else if (modelType === 'Guest') {
    // Add defaults for required Guest fields if missing
    if (!object.name || String(object.name).trim() === "") {
      log.warn('[cloneAssistant] Guest missing name, defaulting', { originalId: object._id });
      object.name = 'Unnamed Guest';
    }
    if (!object.phone_number || String(object.phone_number).trim() === "") {
      log.warn('[cloneAssistant] Guest missing phone_number, defaulting', { originalId: object._id });
      object.phone_number = 'N/A'; // Or a more appropriate placeholder
    }
    if (!object.passPhrase || String(object.passPhrase).trim() === "") {
      log.warn('[cloneAssistant] Guest missing passPhrase, defaulting', { originalId: object._id });
      object.passPhrase = 'defaultPassphrase'; // Ensure this meets any length/complexity if validated elsewhere
    }
  }
  return object;
}

// Clone an existing assistant
export async function cloneAssistant(
  assistantIdToClone: string,
  cloneParams: CloneAssistantParams
): Promise<IAssistant> {
  log.info('[cloneAssistant] Called', { assistantIdToClone, cloneParams });
  try {
    const prism = await Prism.getInstance();
    const assistantObject = await getAssistantById(assistantIdToClone);
    if (!assistantObject) {
      log.error('[cloneAssistant] Source assistant not found', { assistantIdToClone });
      throw new APIError('Source assistant not found', 404);
    }
    const tenantId = assistantObject.tenantId;

    log.debug('[cloneAssistant] Found assistant to clone', { assistantIdToClone, assistant: JSON.parse(JSON.stringify(assistantObject)) });

    const validModels = [
      'nova-2-general', 'nova-2', 'nova-3', 'nova-3-general', 'nova-2-meeting', 'nova-2-phone-call',
      'nova-2-finance', 'nova-2-conversationalai', 'nova-2-voicemail', 'nova-2-video', 'nova-2-medical',
      'nova-2-drivethru', 'nova-2-automotive', 'whisper', 'gpt-4o-mini', 'default', 'fast', 'accurate', 'scribe_v1',
    ];
    const defaultModel = 'gpt-4o-mini';

    if (assistantObject.model && assistantObject.model.model && !validModels.includes(assistantObject.model.model)) {
      log.warn('[cloneAssistant] Assistant model not in valid enum, defaulting', { assistantIdToClone, originalModel: assistantObject.model.model, defaultModel });
      assistantObject.model.model = defaultModel;
    }

    delete assistantObject._id;
    delete assistantObject.subDomain;
    log.debug('[cloneAssistant] Assistant object after deletions', { assistantIdToClone, assistant: assistantObject });

    let subdomainToUse = cloneParams.newSubdomain;
    if (!subdomainToUse) {
      subdomainToUse = cloneParams.newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!subdomainToUse) {
        // Generate random subdomain using crypto-based approach (no mongodb dependency)
        const randomHex = Array.from(
          { length: 12 },
          () => Math.floor(Math.random() * 16).toString(16)
        ).join('');
        subdomainToUse = randomHex; // Fallback if name is all special chars
      }
    }
    log.debug('[cloneAssistant] Subdomain initial candidate', { assistantIdToClone, subdomainToUse });

    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: 'any',
      where: {
        indexer: { path: "name", equals: cloneParams.newName },
      },
    };

    const result = await prism.query(query);
    if (result && result.total > 0) {
      throw new APIError('An assistant with this name already exists', 409);
    }

    let finalSubdomain = subdomainToUse;
    let counter = 0;
  while (await getAssistantBySubDomain(finalSubdomain || null)) {
      counter++;
      finalSubdomain = `${subdomainToUse}-${counter}`;
    }
    subdomainToUse = finalSubdomain;
    log.info('[cloneAssistant] Subdomain resolved', { assistantIdToClone, subdomainToUse });

    const clonedAssistantData: any = {
      ...assistantObject,
      name: cloneParams.newName,
      subDomain: subdomainToUse,
      is_template: false,
      template_category: undefined,
      template_display_name: undefined,
      template_description: undefined,
      template_icon_url: undefined,
      persona_name: cloneParams.persona_name !== undefined ? cloneParams.persona_name : (assistantObject as any).persona_name,
      special_instructions: cloneParams.special_instructions !== undefined ? cloneParams.special_instructions : assistantObject.special_instructions,
    };
    log.debug('[cloneAssistant] Data before EJS render', { assistantIdToClone, clonedAssistantData: JSON.parse(JSON.stringify(clonedAssistantData)) });

    // Manually render systemPrompt using EJS if persona_name or special_instructions are present
    // or if the prompt itself looks like an EJS template (basic check)
    if (clonedAssistantData.model && clonedAssistantData.model.systemPrompt &&
      (clonedAssistantData.model.systemPrompt.includes('<%') || clonedAssistantData.persona_name || clonedAssistantData.special_instructions)) {
      log.debug('[cloneAssistant] Manually rendering systemPrompt before create', {
        assistantIdToClone,
        systemPrompt: clonedAssistantData.model.systemPrompt,
        personaName: clonedAssistantData.persona_name,
        specialInstructions: clonedAssistantData.special_instructions,
      });
      try {
        const template = clonedAssistantData.model.systemPrompt;
        // Create a data object for EJS, ensuring all expected fields from assistantObject are there if template uses them broadly
        const ejsDataPayload = {
          ...clonedAssistantData, // provides name, etc.
          persona_name: clonedAssistantData.persona_name || '',
          special_instructions: clonedAssistantData.special_instructions || '',
          // assistant: clonedAssistantData // EJS 'assistant' var will be the clonedAssistantData itself
        };
        // For properties that might be nested like assistant.name in template, ensure they are top-level for simple EJS
        // Or ensure template uses assistant.name, assistant.persona_name etc.
        // The current `pre('save')` hook uses `assistant: assistant.toObject()`, so EJS templates might expect `assistant.fieldName`
        // Let's mimic that more closely for consistency if the pre-save hook is bypassed.
        const dataForEjs = {
          persona_name: clonedAssistantData.persona_name || '',
          special_instructions: clonedAssistantData.special_instructions || '',
          assistant: clonedAssistantData // This makes assistant.name, assistant.persona_name etc. available in EJS
        };

        const renderedPrompt = ejs.render(template, dataForEjs);
        clonedAssistantData.model.systemPrompt = renderedPrompt;
        log.debug('[cloneAssistant] Manually rendered systemPrompt', { assistantIdToClone, subdomainToUse, renderedPrompt });
      } catch (error) {
        log.error('[cloneAssistant] Error manually rendering EJS', { assistantIdToClone, error });
      }
    }

    const clonedAssistant = await prism.create(BlockType_Assistant, clonedAssistantData, tenantId);
    if (!clonedAssistant || clonedAssistant.total === 0 || clonedAssistant.items.length === 0) {
      log.error('[cloneAssistant] Failed to create new assistant', { assistantIdToClone, tenantId });
      throw new APIError('Failed to create new assistant', 500);
    }
    log.info('[cloneAssistant] Created new assistant', { assistantIdToClone, newAssistantId: clonedAssistant.items[0]._id });

    const originalAssistantId = assistantIdToClone;
    const newClonedAssistantId = clonedAssistant.items[0]._id;
    const whereParentIsAssistant = { parent_id: originalAssistantId };

    const contentBlocks = ['Activity', 'Agenda', 'EventMap', 'Exhibitor', 'Guest', 'IframeKeyword', 'KeywordMemory', 'MenuItem', 'Photo', 'Registration', 'Service', 'ShoreExcursion', 'Speaker'];
    for (const contentBlockType of contentBlocks) {
      try {

        const query: PrismContentQuery = {
          contentType: contentBlockType,
          tenantId: tenantId,
          where: whereParentIsAssistant,
        };

        const def_result = await prism.findDefinition(contentBlockType, (assistantObject as any).tenantId as string);
        if (!def_result || def_result.total === 0) {
          log.warn('[cloneAssistant] No content definition found, skipping cloning', { contentBlockType, assistantIdToClone });
          continue;
        }
        const definition = def_result.items[0] as IDynamicContent;
        const result = await prism.query(query);
        if (result && result.total > 0) {
          log.info('[cloneAssistant] Found documents to clone', { contentBlockType, total: result.total, assistantIdToClone });
          for (const entry of result.items) {
            delete entry._id; // Remove original ID
            // set the new assistant id in the entry if the definition has assistant_id field
            const fields = Object.keys(definition.dataModel.jsonSchema.properties || {});
            if (fields && 'assistant_id' in fields) {
              entry.assistant_id = newClonedAssistantId; // Link to new assistant
            }
            const final = handleSpecialCases(entry, contentBlockType);
            const created = await prism.create(contentBlockType, final, tenantId);
            if (!created || created.total === 0 || created.items.length === 0) {
              log.error('[cloneAssistant] Failed to clone content block', { contentBlockType, newClonedAssistantId, assistantIdToClone });
              continue; // Skip to next entry if creation fails
            }
            log.debug('[cloneAssistant] Cloned content block', { contentBlockType, newClonedAssistantId, assistantIdToClone });
          }
        }
      } catch (error) {
        log.error('Error cloning content for assistant', { contentBlockType, assistantIdToClone, error });
      }
    }

    // --- End cloning associated data ---

    safeRevalidatePath('/assistants');
    safeRevalidatePath(`/dashboard/assistants`);
    safeRevalidatePath(`/dashboard/assistants/${newClonedAssistantId}`);

    return migrateAssistantOnLoad(clonedAssistant.items[0] as unknown as IAssistant);
  } catch (error) {
    log.error('[cloneAssistant] Error in cloneAssistant', { assistantIdToClone, error });
    if (error instanceof APIError) {
      throw error;
    }
    throw new APIError('Failed to clone assistant', 500);
  }
}

// Get all "template" assistants for the logged-in user
export async function getTemplateAssistants(tenantId: string, userId: string): Promise<IAssistant[] | undefined> {
  try {
    const prism = await Prism.getInstance();
    if (!userId || !tenantId) {
      log.error('[getTemplateAssistants] userId and tenantId must be provided', { tenantId, userId });
      throw new APIError('Unauthorized', 401);
    }

    // Fetch assistants that are marked as templates and belong to the current user
    // You might adjust the query if you have a concept of global templates (e.g., no user field, or a specific system user ID)
    const query: PrismContentQuery = {
      contentType: BlockType_Assistant,
      tenantId: tenantId,
      where: {
        parent_id: tenantId, // Ensure we only fetch assistants for the current tenant
        AND: [
          { content: { like: `%"is_template":true%`, } },
        ]
      }
    };

    const result = await prism.query(query);
    if (!result || result.total === 0) {
      log.info('[getTemplateAssistants] No template assistants found for tenant', { tenantId });
      // .find() returns an empty array if no documents match, not null/undefined,
      // so this check might not be strictly necessary unless an error occurs that makes it null.
      // Usually, you'd just return the (potentially empty) array.
      return []; // Return an empty array if none are found
    }

    const sortedTemplateAssistants = result.items.sort(
      (a: IAssistant, b: IAssistant) => {
        return (a.template_category || 0) - (b.template_category || 0);
      }
    );

    return sortedTemplateAssistants.map(migrateAssistantOnLoad);
  } catch (error) {
    // Log the error for server-side debugging
    log.error('[getTemplateAssistants] Error fetching template assistants', { tenantId, userId, error });

    // Handle specific errors or re-throw a generic one
    // You can use your handleError utility or APIError class if appropriate
    // For example:
    // if (error instanceof APIError) throw error;
    // throw new APIError('Failed to fetch template assistants', 500);

    handleError(error); // Using your existing error handler
    return undefined; // Or return empty array / throw, depending on how your frontend handles errors
  }
}

export async function createFeedback(feedbackData: AssistantFeedbackBlock.IAssistantFeedback) {
  const prism = await Prism.getInstance();
  const created = await prism.create(AssistantFeedbackBlock.BlockType_AssistantFeedback, feedbackData, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create assistant feedback');
  }
  return created.items[0] as unknown as AssistantFeedbackBlock.IAssistantFeedback;
}

export async function getAssistantContent(assistantId: string) {
  const assistant = await getAssistantById(assistantId);
  if (!assistant) {
    throw new Error(`Assistant with ID ${assistantId} not found`);
  }
  const contentTypes = assistant.contentTypes || [];
  // need to return the content type and their associated _ids
  const assistantContent: Record<string, string[]> = {};
  for (const contentType of contentTypes) {
    const query: PrismContentQuery = {
      contentType: contentType,
      tenantId: assistant.tenantId,
      where: { parent_id: assistant._id },
      select: ['page_id'], // Only fetch page_id from the DB
    };
    const prism = await Prism.getInstance();
    const result = await prism.query(query);
    if (result && result.total > 0) {
      assistantContent[contentType] = result.items.map((item: any) => item._id);
    } else {
      assistantContent[contentType] = [];
    }
  }
  return assistantContent;
}