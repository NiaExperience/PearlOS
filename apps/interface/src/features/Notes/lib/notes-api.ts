import { getClientLogger } from '@interface/lib/client-logger';

import { fuzzySearch } from './fuzzy-search';

const log = getClientLogger('Notes');

export interface Note {
    _id: string;
    title: string;
    content?: string;
    mode: 'personal' | 'work';
    createdAt?: string;
    updatedAt?: string;
    isPinned?: boolean;
    sharedVia?: {
        organization?: any;
        role?: string;
    };
}

export interface FindNoteResult {
    found: boolean;
    note?: Note;
    allNotes?: Note[];
    searchPerformed: boolean;
}

/** Batch types for incremental loading */
export type NoteBatchType = 'personal' | 'work' | 'shared-to-user' | 'shared-to-all';

/** Shape of each streamed batch from the server */
export interface NoteBatch {
    batch: NoteBatchType;
    items: Note[];
    done: boolean;
    error?: string;
}

/** Callback for when a batch arrives */
export type OnNoteBatchCallback = (batch: NoteBatch) => void;

export async function fetchNotes(mode: 'personal' | 'work' | undefined, assistantName: string) {
    const query = mode ? `&mode=${mode}` : '';
    const res = await fetch('/api/notes?agent=' + assistantName + query);
    if (!res.ok) throw new Error('Failed to fetch notes');
    return res.json();
}

/**
 * Fetch notes incrementally using Server-Sent Events (SSE).
 * Batches arrive progressively: personal → work → shared-to-user → shared-to-all
 * 
 * @param assistantName - Assistant name for API context
 * @param mode - Mode filter ('personal' | 'work' | 'all')
 * @param onBatch - Callback invoked for each batch
 * @returns Promise that resolves when all batches complete, with cleanup function
 */
export function fetchNotesIncremental(
    assistantName: string,
    mode: 'personal' | 'work' | 'all' = 'all',
    onBatch: OnNoteBatchCallback
): { promise: Promise<Note[]>; abort: () => void } {
    const allNotes: Note[] = [];
    const seenIds = new Set<string>();
    let eventSource: EventSource | null = null;
    let aborted = false;

    const abort = () => {
        aborted = true;
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
    };

    const promise = new Promise<Note[]>((resolve, reject) => {
        const url = `/api/notes/incremental?agent=${encodeURIComponent(assistantName)}&mode=${mode}&stream=true`;
        log.info('Starting incremental notes fetch (SSE)', { url, mode });

        eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
            if (aborted) return;
            
            try {
                const batch: NoteBatch = JSON.parse(event.data);
                log.debug('Received notes batch', { 
                    batch: batch.batch, 
                    itemCount: batch.items.length, 
                    done: batch.done 
                });

                // Deduplicate and collect items
                for (const item of batch.items) {
                    const id = item._id;
                    if (id && !seenIds.has(id)) {
                        seenIds.add(id);
                        allNotes.push(item);
                    }
                }

                // Invoke callback
                onBatch(batch);

                // Check if complete
                if (batch.done) {
                    eventSource?.close();
                    eventSource = null;
                    log.info('Incremental notes fetch complete', { totalNotes: allNotes.length });
                    resolve(allNotes);
                }
            } catch (err) {
                log.error('Failed to parse SSE batch', { err, data: event.data });
            }
        };

        eventSource.onerror = (err) => {
            if (aborted) return;
            
            log.error('SSE connection error', { err });
            eventSource?.close();
            eventSource = null;
            
            // Don't reject - return what we have
            if (allNotes.length > 0) {
                resolve(allNotes);
            } else {
                reject(new Error('Connection error while loading notes'));
            }
        };
    });

    return { promise, abort };
}

/**
 * Fetch notes incrementally using standard JSON (fallback for non-SSE environments)
 */
export async function fetchNotesIncrementalJSON(
    assistantName: string,
    mode: 'personal' | 'work' | 'all' = 'all'
): Promise<{ batches: NoteBatch[]; items: Note[] }> {
    const url = `/api/notes/incremental?agent=${encodeURIComponent(assistantName)}&mode=${mode}&stream=false`;
    log.info('Fetching notes incremental (JSON)', { url, mode });

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error('Failed to fetch notes');
    }

    const data = await res.json();
    return {
        batches: data.batches || [],
        items: data.items || [],
    };
}

export async function createNote(note: { title: string; content: string; mode: 'personal' | 'work' }, assistantName: string) {
    const res = await fetch('/api/notes?agent=' + assistantName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify(note),
    });
    if (!res.ok) throw new Error('Failed to create note');
    return res.json();
}

export async function updateNote(id: string, note: { title: string; content: string; isPinned?: boolean }, assistantName: string) {
    const res = await fetch(`/api/notes/${id}?agent=` + assistantName, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
    });
    if (!res.ok) throw new Error('Failed to update note');
    return res.json();
}

export async function deleteNote(id: string, assistantName: string) {
    const res = await fetch(`/api/notes/${id}?agent=` + assistantName, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to delete note');
    return res.json();
}

/**
 * Find a note by ID or title with fuzzy search fallback
 * 
 * Strategy:
 * 1. If ID is provided, search by ID directly
 * 2. If title is provided, try exact title match first
 * 3. If no exact match, perform fuzzy search across all notes
 * 4. Return the best match or all notes if no good match found
 * 
 * @param params - Search parameters (id or title)
 * @param assistantName - Assistant name for API calls
 * @returns FindNoteResult with found status and note data
 */
export async function findNoteWithFuzzySearch(
    params: { id?: string; title?: string },
    assistantName: string
): Promise<FindNoteResult> {
    const { id, title } = params;
    
    try {
        // Strategy 1: Search by ID (most specific)
        if (id) {
            const queryParams = new URLSearchParams();
            queryParams.set('agent', assistantName);
            
            const response = await fetch(`/api/notes/${id}?${queryParams.toString()}`);

            if (response.ok) {
                const notes = await response.json();
                log.debug('fetch(/api/notes/:id) returned results', {
                    id,
                    results: notes.length,
                });
                if (Array.isArray(notes) && notes.length > 0) {
                    return {
                        found: true,
                        note: notes[0],
                        searchPerformed: false
                    };
                }
                log.warn('fetch(/api/notes/:id) returned no results or non-array', { id });
            }
            else {
                log.warn('Note by id not found', { id, status: response.status });
            }
            
            // ID not found, fall through to fetch all notes
        }
        
        // Strategy 2: Try exact title match first
        if (title) {
            const queryParams = new URLSearchParams();
            queryParams.set('agent', assistantName);
            queryParams.set('title', title);
            
            const response = await fetch(`/api/notes?${queryParams.toString()}`);
            
            if (response.ok) {
                const notes = await response.json();
                log.debug('fetch(/api/notes?title) returned results', {
                    title,
                    results: notes.length,
                });
                if (Array.isArray(notes) && notes.length > 0) {
                    log.debug('Note found by title', {
                        title,
                        contentLength: notes[0]?.content?.length || 0,
                    });
                    return {
                        found: true,
                        note: notes[0],
                        searchPerformed: false
                    };
                }
                log.warn('fetch(/api/notes?title) returned no results or non-array', { title });
            }
        }
        
        // Strategy 3: Fuzzy search across all notes (all modes)
        if (title) {
            log.info('Note not found by exact title, performing fuzzy search', { title });
            
            const filteredTitle = title
                .trim()
                .toLowerCase()
                .replace(/(^|\s)note(\s|$)/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            // Fetch all notes (don't specify mode to get everything)
            const allNotesParams = new URLSearchParams();
            allNotesParams.set('agent', assistantName);
            const allNotesResponse = await fetch(`/api/notes?${allNotesParams.toString()}`);
            
            if (allNotesResponse.ok) {
                const allNotes = await allNotesResponse.json();
                
                if (Array.isArray(allNotes) && allNotes.length > 0) {
                    log.info('Fuzzy searching across notes', { totalNotes: allNotes.length, title });
                    
                    // Perform fuzzy search
                    const fuzzyResults = fuzzySearch<Note>(
                        allNotes,
                        filteredTitle,
                        (note) => note.title,
                        { minScore: 0.6, maxResults: 1, sortByScore: true }
                    );
                    
                    if (fuzzyResults.length > 0) {
                        log.info('Fuzzy search found match', {
                            title,
                            matchTitle: fuzzyResults[0].item.title,
                            score: fuzzyResults[0].score,
                            mode: fuzzyResults[0].item.mode,
                        });
                        return {
                            found: true,
                            note: fuzzyResults[0].item,
                            allNotes,
                            searchPerformed: true
                        };
                    }
                    
                    // No fuzzy match found, return all notes for context
                    log.info('No fuzzy match found for title', { title });
                    return {
                        found: false,
                        allNotes,
                        searchPerformed: true
                    };
                }
                
                // Empty array returned - no notes exist
                if (Array.isArray(allNotes) && allNotes.length === 0) {
                    return {
                        found: false,
                        searchPerformed: false // Can't search if there are no notes
                    };
                }
            }
        }
        
        // No match found and unable to fetch notes
        return {
            found: false,
            searchPerformed: false
        };
        
    } catch (error) {
        log.error('Error in findNoteWithFuzzySearch', { error });
        return {
            found: false,
            searchPerformed: false
        };
    }
}