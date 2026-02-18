/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';


import { Prism } from '@nia/prism';
import { UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { PrismContentQuery } from '@nia/prism/core/types';
import { isValidUUID } from '@nia/prism/core/utils';

import { Note, NotesDefinition } from '@interface/features/Notes';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('Notes');

// Update Note Input Type
export type UpdateNoteParams = Partial<Note>;

/**
 * Creates the notes definition schema in the Prism system for a specific tenant.
 * This establishes the data structure and validation rules for note objects.
 * 
 * @param tenantId - The tenant identifier to scope the definition
 * @returns Promise resolving to the created notes definition
 * @throws Error if definition creation fails or returns empty result
 * 
 * @example
 * ```typescript
 * const definition = await createNotesDefinition('tenant123');
 * ```
 */
export async function createNotesDefinition(tenantId: string) {
    const prism = await Prism.getInstance();
    const created = await prism.createDefinition(NotesDefinition, tenantId);
    if (!created || created.total === 0 || created.items.length === 0) {
        throw new Error('Failed to create notes definition');
    }
    return created.items[0];
}

/**
 * Ensures that the notes definition exists before executing an operation.
 * If the definition doesn't exist, it creates it automatically and retries the operation.
 * This is a helper function that provides resilient operation handling.
 * 
 * @param operation - The async operation to execute that requires the notes definition
 * @param tenantId - The tenant identifier for creating the definition if needed
 * @returns Promise resolving to the operation result
 * @throws Error if the operation fails even after ensuring definition exists
 * 
 * @internal This is an internal helper function
 */
async function ensureNotesDefinition(operation: () => Promise<any>, tenantId: string) {
    let result;
    try {
        result = await operation();
    } catch (error) {
        const msg = `Content definition for type "${NotesDefinition.dataModel.block}" not found.`;
        if (error instanceof Error && error.message.includes(msg)) {
            await createNotesDefinition(tenantId);
            // Retrying operation after creating definition
            result = await operation(); // Retry the operation after creating the definition
        } else {
            log.error('Error in ensureNotesDefinition', { error });
            throw error;
        }
    }
    return result;
}

/**
 * Creates a new note for the currently authenticated user.
 *
 * @param noteData - The note data to be created.
 * @returns A promise that resolves to the created `Note` object.
 * @throws Will throw an error if the user is not authenticated or if note creation fails.
 */
export async function createNote(noteData: Note, tenantId: string): Promise<Note> {
    try {
        const session = await getSessionSafely(undefined, interfaceAuthOptions);
        if (!session || !session.user || !session.user.id) {
            throw new Error('Unauthorized');
        }
        if (!isValidUUID(session.user.id)) {
            throw new Error('Invalid user ID - must be a valid UUID');
        }

        const sessionUserId = session.user.id;
        // Prevent cross-user creation when authenticated.
        if (noteData.userId && noteData.userId !== sessionUserId) {
            throw new Error('Forbidden: cannot create note for another user');
        }

        return await createNoteInternal(noteData, tenantId, sessionUserId);

    } catch (error) {
        log.error('Error creating note', { error });
        throw error;
    }
}

/**
 * Creates a note for a provided userId without fetching session.
 * Intended for API route handlers that already resolved/authenticated a user context
 * (or explicit local/test mode fallbacks).
 */
export async function createNoteAsUser(noteData: Note, tenantId: string, userId: string): Promise<Note> {
    return await createNoteInternal(noteData, tenantId, userId);
}

async function createNoteInternal(noteData: Note, tenantId: string, userId: string): Promise<Note> {
    const prism = await Prism.getInstance();
    if (!userId || !isValidUUID(userId)) {
        throw new Error('Invalid user ID - must be a valid UUID');
    }
    if (!tenantId || !isValidUUID(tenantId)) {
        throw new Error('Invalid tenant ID');
    }

    // Apply business logic
    noteData = await applyBusinessLogic(noteData);

    // Normalize title for case-insensitive searches
    const normalizeTitle = (t?: string) => (t || '').trim().toLowerCase();

    const note = {
        ...noteData,
        userId,
        tenantId, // Include tenantId in content so it's returned in query results
        normalizedTitle: normalizeTitle(noteData.title),
    } as any;

    const func = async () => {
        return await prism.create(NotesDefinition.dataModel.block, note, tenantId);
    };
    const created = await ensureNotesDefinition(func, tenantId);
    if (!created || created.total === 0 || created.items.length === 0) {
        throw new Error('Failed to create note');
    }
    return created.items[0] as unknown as Note;
}

/**
 * Finds a specific note by its unique identifier.
 * 
 * @param noteId - The unique identifier of the note to retrieve
 * @param tenantId - The tenant identifier to scope the search
 * @returns Promise resolving to the Note object or null if not found
 * @throws Error if noteId is missing or if query execution fails
 * 
 * @example
 * ```typescript
 * const note = await findNoteById('note123', 'tenant123');
 * if (note) {
 *   log.info('Found note by id', { noteId: note.page_id, title: note.title });
 * }
 * ```
 */
export async function findNoteById(noteId: string, tenantId: string): Promise<Note | null> {
    if (!noteId) {
        throw new Error('noteId is required');
    }
    const prism = await Prism.getInstance();
    const query = {
        contentType: NotesDefinition.dataModel.block,
        tenantId,
        where: { page_id: { eq: noteId } },
        orderBy: { createdAt: 'desc' as const },
    };

    const func = async () => {
        return await prism.query(query);
    };
    const result = await ensureNotesDefinition(func, tenantId);

    if (!result.items || result.items.length === 0) return null;
    let note = result.items[0] as Note & { normalizedTitle?: string; page_id?: string; _id?: string };
    // Backfill normalizedTitle if missing
    if (!note.normalizedTitle && note.title) {
        const normalizedTitle = note.title.trim().toLowerCase();
        try {
            const id = (note as any).page_id || (note as any)._id || noteId;
            await prism.update(NotesDefinition.dataModel.block, id, { normalizedTitle }, tenantId);
            note = { ...note, normalizedTitle };
        } catch (e) {
            log.warn('Failed to backfill normalizedTitle for note', { noteId, error: e });
        }
    }
    return note as Note;
}

/**
 * Finds all notes belonging to a specific user with a matching title.
 * Results are ordered by creation date (newest first).
 * 
 * @param userId - The unique identifier of the user who owns the notes
 * @param tenantId - The tenant identifier to scope the search
 * @param title - The exact title to match against
 * @returns Promise resolving to an array of Note objects or null if none found
 * @throws Error if required parameters are missing
 * 
 * @example
 * ```typescript
 * const notes = await findNotesByUserAndTitle('user123', 'tenant123', 'My Important Note');
 * if (notes) {
 *   log.info('Found notes by title', { count: notes.length, title: 'My Important Note' });
 * }
 * ```
 */
export async function findNotesByUserAndTitle(userId: string, tenantId: string, title: string) {
    if (!userId || !title) {
        throw new Error('userId and title are required');
    }
    if (!isValidUUID(userId)) {
        throw new Error('userId must be a valid UUID');
    }
    const prism = await Prism.getInstance();
    const normalizeTitle = (t?: string) => (t || '').trim().toLowerCase();
    const normalized = normalizeTitle(title);

    // First attempt: query using normalizedTitle (new field)
    const normalizedQuery: PrismContentQuery = {
        contentType: NotesDefinition.dataModel.block,
        tenantId,
        where: {
            indexer: { path: 'normalizedTitle', equals: normalized },
            parent_id: { eq: userId }
        },
        orderBy: { createdAt: 'desc' as const },
        limit: 1000,
    };
    const runQuery = async (q: PrismContentQuery) => ensureNotesDefinition(() => prism.query(q), tenantId);

    let result = await runQuery(normalizedQuery);

    // Fallback for legacy notes without normalizedTitle: fall back to original title (case-sensitive match)
    if (!result.items || result.items.length === 0) {
        const legacyQuery: PrismContentQuery = {
            contentType: NotesDefinition.dataModel.block,
            tenantId,
            where: {
                indexer: { path: 'title', equals: title },
                parent_id: { eq: userId }
            },
            orderBy: { createdAt: 'desc' as const },
            limit: 1000,
        };
        result = await runQuery(legacyQuery);
    }

    if (!result.items || result.items.length === 0) return null;
    const items = result.items as (Note & { normalizedTitle?: string; page_id?: string; _id?: string })[];
    const normalizeFn = (t?: string) => (t || '').trim().toLowerCase();
    // Backfill any missing normalizedTitle entries (legacy records)
    for (const item of items) {
        if (!item.normalizedTitle && item.title) {
            try {
                const id = (item as any).page_id || (item as any)._id;
                await prism.update(NotesDefinition.dataModel.block, id, { normalizedTitle: normalizeFn(item.title) }, tenantId);
                item.normalizedTitle = normalizeFn(item.title);
            } catch (e) {
                log.warn('Failed to backfill normalizedTitle for note', {
                    noteId: (item as any).page_id || (item as any)._id,
                    error: e,
                });
            }
        }
    }
    return items as Note[];
}

/**
 * Finds all notes belonging to a specific user filtered by mode.
 * Mode typically represents different note categories or types (e.g., 'personal', 'work', 'draft').
 * Results are ordered by creation date (newest first).
 * 
 * @param userId - The unique identifier of the user who owns the notes
 * @param tenantId - The tenant identifier to scope the search
 * @param mode - The mode/category to filter notes by
 * @returns Promise resolving to an array of Note objects or null if none found
 * @throws Error if required parameters are missing
 * 
 * @example
 * ```typescript
 * const workNotes = await findNoteByUserAndMode('user123', 'tenant123', 'work');
 * if (workNotes) {
 *   log.info('Found work notes', { count: workNotes.length });
 * }
 * ```
 */
export async function findNoteByUserAndMode(userId: string, tenantId: string, mode: string) : Promise<Note[]> {
    if (!userId || !mode || !tenantId) {
        throw new Error('userId, tenantId and mode are required');
    }
    if (!isValidUUID(userId)) {
        throw new Error('userId must be a valid UUID');
    }
    const prism = await Prism.getInstance();

    // Ensure the user exists
    const user = await UserActions.getUserById(userId);
    if (!user) {
        log.warn('User not found while fetching notes by mode', { userId, tenantId, mode });
        return [];
    }

    // Business logic:
    // - 'work' notes are shared with tenantId and have mode = 'work'
    // - 'personal' (default) notes are private, not shared, and belong to specific user
    // For 'work' mode, we query notes that:
    // 1. Have mode = 'work' 
    // 2. Have tenantId matching the requested tenant (since work notes are created in work tenant)
    let query: PrismContentQuery;
    if (mode === 'work') {
        query = {
            contentType: NotesDefinition.dataModel.block,
            tenantId,
            where: {
                AND: [
                    { indexer: { path: 'mode', equals: mode } },
                    { indexer: { path: 'tenantId', equals: tenantId } }
                ],
            },
            orderBy: { createdAt: 'desc' as const },
            limit: 1000,
        };
    } else {
        // Personal mode: fetch all user notes and filter in memory to include legacy notes (missing mode)
        // Use 'any' tenantId to find personal notes across all tenants since they are user-owned
        query = {
            contentType: NotesDefinition.dataModel.block,
            tenantId: tenantId,
            where: {
                parent_id: { eq: userId }
            },
            orderBy: { createdAt: 'desc' as const },
            limit: 1000,
        };
    }
    // Querying notes based on mode and user/tenant context
    const func = async () => {
        return await prism.query(query);
    };
    const result = await ensureNotesDefinition(func, tenantId);
    if (!result.items || result.items.length === 0) {
        return [];
    }
    
    let items = result.items as (Note & { normalizedTitle?: string; page_id?: string; _id?: string })[];

    // Filter in memory if we are in personal mode to include legacy notes
    if (mode === 'personal') {
        items = items.filter(item => item.mode === 'personal' || !item.mode);
    }

    const normalizeFn = (t?: string) => (t || '').trim().toLowerCase();
    for (const item of items) {
        if (!item.normalizedTitle && item.title) {
            try {
                const id = (item as any).page_id || (item as any)._id;
                await prism.update(NotesDefinition.dataModel.block, id, { normalizedTitle: normalizeFn(item.title) }, tenantId);
                item.normalizedTitle = normalizeFn(item.title);
            } catch (e) {
                log.warn('Failed to backfill normalizedTitle for note', {
                    noteId: (item as any).page_id || (item as any)._id,
                    error: e,
                });
            }
        }
    }
    // Returning notes after optional backfill
    return items as Note[];
}

/**
 * Applies business logic to the note data before creation or update.
 * This can include actions like setting default values, validating fields, or modifying content.
 * 
 * @param noteData - The note data to which business logic should be applied
 * @returns Promise resolving to the processed Note data
 * 
 * @example
 * ```typescript
 * const processedNote = await applyBusinessLogic(noteData);
 * ```
 */
export async function applyBusinessLogic(noteData: Note) : Promise<Note> {
    return noteData;
}

/**
 * Updates an existing note.
 * 
 * @param noteId - The unique identifier of the note to update
 * @param updates - The partial note data to update
 * @param tenantId - The tenant identifier
 * @returns Promise resolving to the updated Note object
 */
export async function updateNote(noteId: string, updates: UpdateNoteParams, tenantId: string): Promise<Note> {
    if (!noteId || !tenantId) {
        throw new Error('noteId and tenantId are required');
    }
    const prism = await Prism.getInstance();
    
    // Normalize title if present
    if (updates.title) {
        (updates as any).normalizedTitle = updates.title.trim().toLowerCase();
    }

    const func = async () => {
        return await prism.update(NotesDefinition.dataModel.block, noteId, updates, tenantId);
    };
    
    const result = await ensureNotesDefinition(func, tenantId);
    if (result && result.items && result.items.length > 0) {
        return result.items[0] as Note;
    }
    return result as Note;
}

/**
 * Deletes a note by its ID.
 * 
 * @param noteId - The unique identifier of the note to delete
 * @param tenantId - The tenant identifier
 * @returns Promise resolving to the deleted Note object
 */
export async function deleteNote(noteId: string, tenantId: string): Promise<Note> {
    if (!noteId || !tenantId) {
        throw new Error('noteId and tenantId are required');
    }

    const note = await findNoteById(noteId, tenantId);
    if (!note) {
        throw new Error('Note not found');
    }

    const prism = await Prism.getInstance();
    
    const func = async () => {
        return await prism.delete(NotesDefinition.dataModel.block, noteId, tenantId);
    };
    
    const result = await ensureNotesDefinition(func, tenantId);
    if (result === false) {
        throw new Error('Failed to delete note');
    }
    return note;
}

/**
 * Batch fetch notes by IDs. Single query instead of N individual fetches.
 * 
 * @param noteIds - Array of note IDs to fetch
 * @param tenantId - The tenant identifier to scope the search
 * @returns Promise resolving to an array of Note objects (may be fewer than requested if some not found)
 * 
 * @example
 * ```typescript
 * const notes = await findNotesByIds(['id1', 'id2', 'id3'], 'tenant123');
 * ```
 */
export async function findNotesByIds(noteIds: string[], tenantId: string): Promise<Note[]> {
    if (!noteIds || noteIds.length === 0) {
        return [];
    }
    if (!tenantId) {
        throw new Error('tenantId is required');
    }

    const prism = await Prism.getInstance();
    
    // Use OR query to fetch all notes in a single request
    const query: PrismContentQuery = {
        contentType: NotesDefinition.dataModel.block,
        tenantId,
        where: {
            OR: noteIds.map(id => ({ page_id: { eq: id } }))
        },
        orderBy: { createdAt: 'desc' as const },
        limit: noteIds.length,
    };

    const func = async () => {
        return await prism.query(query);
    };
    
    const result = await ensureNotesDefinition(func, tenantId);
    
    if (!result.items || result.items.length === 0) {
        return [];
    }
    
    return result.items as Note[];
}

/**
 * Fetch notes by user ID with optional mode filter.
 * Optimized for incremental loading - returns only the requested batch.
 * 
 * @param userId - The user ID to fetch notes for
 * @param tenantId - The tenant identifier
 * @param mode - Optional mode filter ('personal' | 'work')
 * @returns Promise resolving to an array of Note objects
 */
export async function findNotesByUserId(
    userId: string, 
    tenantId: string, 
    mode?: 'personal' | 'work'
): Promise<Note[]> {
    if (!userId || !tenantId) {
        throw new Error('userId and tenantId are required');
    }
    if (!isValidUUID(userId)) {
        throw new Error('userId must be a valid UUID');
    }

    const prism = await Prism.getInstance();
    
    let query: PrismContentQuery;
    
    if (mode === 'work') {
        // Work notes are scoped to tenant
        query = {
            contentType: NotesDefinition.dataModel.block,
            tenantId,
            where: {
                AND: [
                    { indexer: { path: 'mode', equals: 'work' } },
                    { indexer: { path: 'tenantId', equals: tenantId } }
                ],
            },
            orderBy: { createdAt: 'desc' as const },
            limit: 1000,
        };
    } else if (mode === 'personal') {
        // Personal notes belong to user
        // Fetch all user notes first, then filter in memory for personal mode
        // This avoids using NOT operator which isn't supported by the GraphQL schema
        query = {
            contentType: NotesDefinition.dataModel.block,
            tenantId,
            where: {
                parent_id: { eq: userId }
            },
            orderBy: { createdAt: 'desc' as const },
            limit: 1000,
        };
    } else {
        // All notes for user
        query = {
            contentType: NotesDefinition.dataModel.block,
            tenantId,
            where: { parent_id: { eq: userId } },
            orderBy: { createdAt: 'desc' as const },
            limit: 1000,
        };
    }

    const func = async () => {
        return await prism.query(query);
    };
    
    const result = await ensureNotesDefinition(func, tenantId);
    
    if (!result.items || result.items.length === 0) {
        return [];
    }
    
    let items = result.items as Note[];
    
    // For personal mode, filter in memory to include notes with mode='personal' or no mode (legacy)
    if (mode === 'personal') {
        items = items.filter(note => note.mode === 'personal' || !note.mode);
    }
    
    return items;
}