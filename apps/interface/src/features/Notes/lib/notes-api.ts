import { getClientLogger } from '@interface/lib/client-logger';

import { fuzzySearch } from './fuzzy-search';

const log = getClientLogger('Notes');

// ─── Dual-source notes: filesystem + database ──────────────────────────────
// File notes: .md files in /workspace/user/Documents/ via /api/notes/files
// DB notes: stored in the database via /api/notes?agent=<name>
// Both sources are merged and deduplicated by title.

const FILE_API = '/api/notes/files';
const DB_API = '/api/notes';

export interface Note {
    _id: string;
    title: string;
    content?: string;
    mode: 'personal' | 'work';
    createdAt?: string;
    updatedAt?: string;
    isPinned?: boolean;
    filePath?: string;
    fileName?: string;
    sharedVia?: {
        organization?: any;
        role?: string;
    };
    _source?: 'file' | 'db';
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

// ─── Helpers: fetch from each source and merge ──────────────────────────────

async function fetchFileNotes(): Promise<Note[]> {
    try {
        const res = await fetch(FILE_API);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        log.error('Failed to fetch file notes', { error: e });
        return [];
    }
}

async function fetchDbNotes(assistantName: string): Promise<Note[]> {
    if (!assistantName) return [];
    try {
        // Fetch both personal and work notes from the database so all stored
        // documents are visible in the UI, not just one mode.
        const [personalRes, workRes] = await Promise.all([
            fetch(`${DB_API}?agent=${encodeURIComponent(assistantName)}&mode=personal`).catch(() => null),
            fetch(`${DB_API}?agent=${encodeURIComponent(assistantName)}&mode=work`).catch(() => null),
        ]);

        const parse = async (res: Response | null): Promise<any[]> => {
            if (!res || !res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        };

        const [personalNotes, workNotes] = await Promise.all([
            parse(personalRes),
            parse(workRes),
        ]);

        // Combine and deduplicate by _id (same note may appear in both queries)
        const seenIds = new Set<string>();
        const combined: Note[] = [];
        for (const n of [...personalNotes, ...workNotes]) {
            const id = n._id || n.page_id;
            if (id && seenIds.has(id)) continue;
            if (id) seenIds.add(id);
            combined.push({ ...n, _source: 'db' as const });
        }
        return combined;
    } catch (e) {
        log.error('Failed to fetch DB notes', { error: e });
        return [];
    }
}

/**
 * Merge file-based and database notes.
 * File notes take priority — DB notes whose titles already exist as file
 * notes are skipped (file is the canonical copy). Multiple DB notes with
 * the same title but different IDs are all kept so no user content is hidden.
 */
function mergeNotes(fileNotes: Note[], dbNotes: Note[]): Note[] {
    const fileTitles = new Set<string>();
    const seenIds = new Set<string>();
    const merged: Note[] = [];

    // Add file notes first (they take priority)
    for (const note of fileNotes) {
        const normTitle = note.title.trim().toLowerCase();
        fileTitles.add(normTitle);
        seenIds.add(note._id);
        merged.push(note);
    }

    // Add DB notes that don't duplicate file notes (by title) or any note (by id)
    for (const note of dbNotes) {
        const normTitle = note.title.trim().toLowerCase();
        if (fileTitles.has(normTitle) || seenIds.has(note._id)) continue;
        seenIds.add(note._id);
        merged.push(note);
    }

    // Sort by updatedAt descending
    merged.sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
    });

    return merged;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchNotes(_mode: 'personal' | 'work' | undefined, assistantName: string) {
    const [fileNotes, dbNotes] = await Promise.all([
        fetchFileNotes(),
        fetchDbNotes(assistantName),
    ]);
    return mergeNotes(fileNotes, dbNotes);
}

/**
 * File-based incremental fetch — returns all notes in a single batch.
 * Maintains the same interface as the SSE-based version for compatibility.
 */
export function fetchNotesIncremental(
    assistantName: string,
    _mode: 'personal' | 'work' | 'all' = 'all',
    onBatch: OnNoteBatchCallback
): { promise: Promise<Note[]>; abort: () => void } {
    let aborted = false;
    const abort = () => { aborted = true; };

    const promise = (async () => {
        const [fileNotes, dbNotes] = await Promise.all([
            fetchFileNotes(),
            fetchDbNotes(assistantName),
        ]);
        const notes = mergeNotes(fileNotes, dbNotes);

        if (!aborted) {
            onBatch({
                batch: 'personal',
                items: notes,
                done: true,
            });
        }

        return notes;
    })();

    return { promise, abort };
}

/**
 * File-based incremental JSON fetch (fallback).
 */
export async function fetchNotesIncrementalJSON(
    assistantName: string,
    _mode: 'personal' | 'work' | 'all' = 'all'
): Promise<{ batches: NoteBatch[]; items: Note[] }> {
    const [fileNotes, dbNotes] = await Promise.all([
        fetchFileNotes(),
        fetchDbNotes(assistantName),
    ]);
    const items = mergeNotes(fileNotes, dbNotes);
    return {
        batches: [{ batch: 'personal', items, done: true }],
        items,
    };
}

export async function createNote(
    note: { title: string; content: string; mode: 'personal' | 'work' },
    _assistantName: string
) {
    const res = await fetch(FILE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: note.title, content: note.content }),
    });
    if (!res.ok) throw new Error('Failed to create note');
    return res.json();
}

export async function updateNote(
    id: string,
    note: { title: string; content: string; isPinned?: boolean },
    _assistantName: string
) {
    const res = await fetch(FILE_API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title: note.title, content: note.content }),
    });
    if (!res.ok) throw new Error('Failed to update note');
    return res.json();
}

export async function deleteNote(id: string, _assistantName: string) {
    const res = await fetch(FILE_API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error('Failed to delete note');
    return res.json();
}

/**
 * Find a note by ID or title with fuzzy search fallback.
 * File-based implementation: fetches all notes, then searches locally.
 */
export async function findNoteWithFuzzySearch(
    params: { id?: string; title?: string },
    _assistantName: string
): Promise<FindNoteResult> {
    const { id, title } = params;

    try {
        // Strategy 1: Search by ID (filename)
        if (id) {
            try {
                const res = await fetch(`${FILE_API}?id=${encodeURIComponent(id)}`);
                if (res.ok) {
                    const note = await res.json();
                    return { found: true, note, searchPerformed: false };
                }
            } catch {
                // fall through
            }
        }

        // Strategy 2+3: Title search with fuzzy fallback
        if (title) {
            const [fileNotes, dbNotes] = await Promise.all([
                fetchFileNotes(),
                fetchDbNotes(_assistantName),
            ]);
            const allNotes = mergeNotes(fileNotes, dbNotes);
            if (allNotes.length > 0) {

                // Exact title match
                const exact = allNotes.find(
                    n => n.title.toLowerCase() === title.toLowerCase()
                );
                if (exact) {
                    return { found: true, note: exact, searchPerformed: false };
                }

                // Fuzzy search
                const filteredTitle = title
                    .trim()
                    .toLowerCase()
                    .replace(/(^|\s)note(\s|$)/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                const fuzzyResults = fuzzySearch<Note>(
                    allNotes,
                    filteredTitle,
                    (note) => note.title,
                    { minScore: 0.6, maxResults: 1, sortByScore: true }
                );

                if (fuzzyResults.length > 0) {
                    return {
                        found: true,
                        note: fuzzyResults[0].item,
                        allNotes,
                        searchPerformed: true,
                    };
                }

                return { found: false, allNotes, searchPerformed: true };
            }
        }

        return { found: false, searchPerformed: false };
    } catch (error) {
        log.error('Error in findNoteWithFuzzySearch', { error });
        return { found: false, searchPerformed: false };
    }
}
