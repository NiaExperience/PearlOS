/**
 * Unified Notes API
 * 
 * Merges notes from two sources:
 * 1. Markdown files in /workspace/user/Documents/*.md (file-based)
 * 2. Notes stored in PostgreSQL database (notion_blocks where type='Notes')
 * 
 * Database notes that don't exist as files are included in listings.
 * Write operations (create/update/delete) target the filesystem.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const DOCUMENTS_DIR = '/workspace/user/Documents';

// PostgreSQL connection pool for reading database notes
// Use lazy initialization to avoid pool creation failures at import time
let _dbPool: Pool | null = null;
function getDbPool(): Pool {
  if (!_dbPool) {
    _dbPool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'password',
      database: process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || 'testdb',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    _dbPool.on('error', (err) => {
      console.error('[notes/files] Pool background error:', err.message);
      // Reset pool on fatal errors so next request creates a fresh one
      _dbPool = null;
    });
  }
  return _dbPool;
}

interface DbNoteContent {
  title: string;
  content: string;
  mode: 'personal' | 'work';
  userId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

interface UnifiedNote {
  _id: string;
  title: string;
  content: string;
  mode: 'personal' | 'work';
  filePath?: string;
  fileName?: string;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  source?: 'database';
}

/**
 * Fetch notes from the PostgreSQL database (notion_blocks where type='Notes').
 * Returns them in the same shape as file-based notes for easy merging.
 */
async function fetchDbNotesOnce(): Promise<UnifiedNote[]> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT block_id, content, "createdAt", "updatedAt"
     FROM notion_blocks
     WHERE type = 'Notes'
     ORDER BY "updatedAt" DESC`
  );
  return result.rows.map((row: { block_id: string; content: DbNoteContent; createdAt: string; updatedAt: string }) => {
    const c = row.content as DbNoteContent;
    const note: UnifiedNote = {
      _id: `db-${row.block_id}`,
      title: c.title || 'Untitled',
      content: c.content || '',
      mode: (c.mode || 'personal') as 'personal' | 'work',
      filePath: undefined,
      fileName: undefined,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
      isPinned: false,
      source: 'database',
    };
    return note;
  });
}

async function fetchDbNotes(): Promise<UnifiedNote[]> {
  // Retry up to 3 times on connection failure (handles pool cold-start / transient errors)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const notes = await fetchDbNotesOnce();
      if (attempt > 0) {
        console.info(`[notes/files] DB query succeeded on attempt ${attempt + 1}, returning ${notes.length} notes`);
      }
      return notes;
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (attempt < 2) {
        console.warn(`[notes/files] DB query failed (attempt ${attempt + 1}/3), retrying in ${(attempt + 1) * 500}ms...`, msg);
        // Reset pool on connection errors to force fresh connections
        if (msg.includes('connect') || msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
          _dbPool = null;
        }
        await new Promise(r => setTimeout(r, (attempt + 1) * 500));
      } else {
        console.error('[notes/files] Failed to fetch DB notes after 3 attempts. Only filesystem notes will be shown.', msg);
      }
    }
  }
  return [];
}

function ensureDocumentsDir() {
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

function fileToNote(filePath: string): UnifiedNote {
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const basename = path.basename(filePath, '.md');
  
  // Extract title from first heading or use filename
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const title = headingMatch ? headingMatch[1].trim() : basename.replace(/-/g, ' ');
  
  return {
    _id: basename, // filename without .md is the ID
    title,
    content,
    mode: 'personal',
    filePath,
    fileName: path.basename(filePath),
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    isPinned: false,
  };
}

/**
 * GET /api/notes/files - List all markdown files as notes
 * GET /api/notes/files?id=filename - Get a specific note by filename (without .md)
 */
export async function GET(req: NextRequest) {
  ensureDocumentsDir();
  
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  
  if (id) {
    // Check file-based note first
    const filePath = path.join(DOCUMENTS_DIR, `${id}.md`);
    if (fs.existsSync(filePath)) {
      const note = fileToNote(filePath);
      return NextResponse.json(note);
    }
    // Check database note (id format: db-<block_id>)
    if (id.startsWith('db-')) {
      const blockId = id.slice(3);
      try {
        const pool = getDbPool();
        const result = await pool.query(
          `SELECT block_id, content, "createdAt", "updatedAt" FROM notion_blocks WHERE type = 'Notes' AND block_id = $1 LIMIT 1`,
          [blockId]
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];
          const c = row.content as DbNoteContent;
          return NextResponse.json({
            _id: `db-${row.block_id}`,
            title: c.title || 'Untitled',
            content: c.content || '',
            mode: c.mode || 'personal',
            createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
            isPinned: false,
            source: 'database',
          });
        }
      } catch (err) {
        console.error('[notes/files] DB lookup error:', err);
      }
    }
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }
  
  try {
    // 1. File-based notes
    const files = fs.readdirSync(DOCUMENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(DOCUMENTS_DIR, f));
    
    const fileNotes = files.map(f => {
      try { return fileToNote(f); } catch { return null; }
    }).filter(Boolean) as UnifiedNote[];

    // 2. Database notes — fetch and merge with file notes
    const dbNotes = await fetchDbNotes();
    
    // Deduplicate: if a DB note has the exact same title as a file note,
    // keep only the file version (filesystem is canonical).
    // Use a Set for O(1) lookups.
    const fileTitles = new Set(fileNotes.map(n => n.title.toLowerCase().trim()));
    const uniqueDbNotes = dbNotes.filter(
      n => !fileTitles.has(n.title.toLowerCase().trim())
    );

    console.info(`[notes/files] Merged: ${fileNotes.length} file notes + ${uniqueDbNotes.length} DB notes (${dbNotes.length} total DB, ${dbNotes.length - uniqueDbNotes.length} deduped by title)`);

    // 3. Merge: file notes first (they're the canonical source), then unique DB notes
    let notes: UnifiedNote[] = [...fileNotes, ...uniqueDbNotes];
    
    // Filter by title if provided
    if (title) {
      const normalizedTitle = title.trim().toLowerCase();
      notes = notes.filter(n => n && n.title.toLowerCase().includes(normalizedTitle));
    }
    
    // Sort by updated date, newest first
    notes.sort((a, b) => new Date(b!.updatedAt).getTime() - new Date(a!.updatedAt).getTime());
    
    return NextResponse.json(notes);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read documents' }, { status: 500 });
  }
}

/**
 * POST /api/notes/files - Create a new note
 * Body: { title: string, content?: string }
 */
export async function POST(req: NextRequest) {
  ensureDocumentsDir();
  
  try {
    const { title, content = '' } = await req.json();
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    
    let filename = sanitizeFilename(title);
    if (!filename) filename = `note-${Date.now()}`;
    
    // Ensure unique filename
    let filePath = path.join(DOCUMENTS_DIR, `${filename}.md`);
    let counter = 1;
    while (fs.existsSync(filePath)) {
      filePath = path.join(DOCUMENTS_DIR, `${filename}-${counter}.md`);
      counter++;
    }
    
    // If content doesn't start with a heading, prepend the title as H1
    let finalContent = content;
    if (!content.match(/^#\s+/m)) {
      finalContent = `# ${title}\n\n${content}`;
    }
    
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    
    const note = fileToNote(filePath);
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
  }
}

/**
 * PATCH /api/notes/files - Update a note
 * Body: { id: string, title?: string, content?: string }
 */
export async function PATCH(req: NextRequest) {
  ensureDocumentsDir();
  
  try {
    const { id, title, content } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }
    
    const filePath = path.join(DOCUMENTS_DIR, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    
    if (content !== undefined) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
    
    // Handle rename if title changed and it implies a different filename
    let finalPath = filePath;
    if (title !== undefined) {
      const newFilename = sanitizeFilename(title);
      if (newFilename && newFilename !== id) {
        const newPath = path.join(DOCUMENTS_DIR, `${newFilename}.md`);
        if (!fs.existsSync(newPath)) {
          fs.renameSync(filePath, newPath);
          finalPath = newPath;
        }
      }
    }
    
    const note = fileToNote(finalPath);
    return NextResponse.json(note);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }
}

/**
 * DELETE /api/notes/files - Delete a note
 * Body: { id: string }
 */
export async function DELETE(req: NextRequest) {
  ensureDocumentsDir();
  
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }
    
    const filePath = path.join(DOCUMENTS_DIR, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    
    // Move to trash instead of permanent delete
    const trashDir = path.join(DOCUMENTS_DIR, '.trash');
    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true });
    }
    const trashPath = path.join(trashDir, `${id}-${Date.now()}.md`);
    fs.renameSync(filePath, trashPath);
    
    return NextResponse.json({ message: 'Note deleted', trashedTo: trashPath });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
}
