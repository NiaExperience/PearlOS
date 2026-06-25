/**
 * Unified Notes API
 * 
 * Merges notes from two sources:
 * 1. Markdown files in /workspace/user/<tenantId>/<userId>/Documents/*.md (file-based)
 * 2. Notes stored in PostgreSQL database (notion_blocks where type='Notes')
 * 
 * Database notes that don't exist as files are included in listings.
 * New file-note writes target the filesystem; DB-backed notes can be
 * updated/deleted by their synthetic db-<block_id> IDs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AssistantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const USER_ROOT = process.env.PEARLOS_USER_ROOT || '/workspace/user';
if (!process.env.PEARLOS_USER_ROOT) {
  console.warn('[notes/files] WARNING: PEARLOS_USER_ROOT not configured — defaulting to /workspace/user');
}

// PostgreSQL connection pool for reading database notes
// Use lazy initialization to avoid pool creation failures at import time
let _dbPool: Pool | null = null;
function getDbPool(): Pool {
  if (!_dbPool) {
    const databaseUrl = process.env.DATABASE_URL || '';
    if (!databaseUrl && !process.env.POSTGRES_HOST) {
      console.warn('[notes/files] WARNING: Using hardcoded Postgres defaults — neither DATABASE_URL nor POSTGRES_HOST is configured');
    }
    const sslEnabled =
      process.env.POSTGRES_SSL === 'true' ||
      databaseUrl.includes('sslmode=require') ||
      databaseUrl.includes('sslmode=no-verify');
    _dbPool = databaseUrl
      ? new Pool({
        connectionString: databaseUrl,
        ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000,
      })
      : new Pool({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'password',
        database: process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || 'testdb',
        ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
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

type ApiNote = {
  _id: string;
  title: string;
  content: string;
  mode: 'personal' | 'work';
  filePath?: string;
  fileName?: string;
  userId: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  isDiary?: boolean;
  source?: 'database';
};

/**
 * Fetch notes from the PostgreSQL database (notion_blocks where type='Notes').
 * Returns them in the same shape as file-based notes for easy merging.
 */
function isSafeUserId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function roleRank(role: string | undefined): number {
  if (role === 'owner') return 0;
  if (role === 'admin') return 1;
  if (role === 'member') return 2;
  return 3;
}

async function tenantForAssistant(req: NextRequest): Promise<string> {
  const { searchParams } = new URL(req.url);
  const assistantName = (searchParams.get('agent') || searchParams.get('assistantName') || '').trim();
  if (!assistantName) return '';
  const assistant =
    await AssistantActions.getAssistantBySubDomain(assistantName).catch(() => null) ||
    await AssistantActions.getAssistantByName(assistantName).catch(() => null);
  const tenantId = typeof assistant?.tenantId === 'string' ? assistant.tenantId.trim() : '';
  return isSafeUserId(tenantId) ? tenantId : '';
}

function isInside(candidate: string, root: string): boolean {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

function relativePath(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).filter(Boolean).join('/');
}

async function tenantForSession(req: NextRequest, userId: string, sessionUser: any): Promise<string | NextResponse> {
  const { searchParams } = new URL(req.url);
  const requested = searchParams.get('tenantId') || searchParams.get('tenant_id');
  const assistantTenant = requested ? '' : await tenantForAssistant(req);
  const sessionTenant = typeof sessionUser?.tenantId === 'string'
    ? sessionUser.tenantId
    : typeof sessionUser?.tenant_id === 'string'
      ? sessionUser.tenant_id
      : '';
  const roles = await getUserTenantRoles(userId).catch(() => []);
  const sortedRoles = roles
    .filter((role: any) => isSafeUserId(String(role?.tenantId || '')))
    .sort((a: any, b: any) => {
      const rankDiff = roleRank(String(a?.role || '')) - roleRank(String(b?.role || ''));
      if (rankDiff !== 0) return rankDiff;
      return String(a.tenantId).localeCompare(String(b.tenantId));
    });

  if (requested) {
    const selected = sortedRoles.find((role: any) => role?.tenantId === requested)?.tenantId;
    if (!selected || !isSafeUserId(String(selected))) {
      return NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 });
    }
    return String(selected);
  }

  const assistantSelected = assistantTenant
    ? sortedRoles.find((role: any) => role?.tenantId === assistantTenant)?.tenantId
    : '';
  const sessionSelected = sessionTenant && isSafeUserId(sessionTenant)
    ? sortedRoles.find((role: any) => role?.tenantId === sessionTenant)?.tenantId || (!sortedRoles.length ? sessionTenant : '')
    : '';
  const selected = assistantSelected || sessionSelected || sortedRoles[0]?.tenantId || 'personal';
  if (!selected || !isSafeUserId(String(selected))) {
    return NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 });
  }
  return String(selected);
}

async function requireSessionUser(req: NextRequest): Promise<{ userId: string; tenantId: string } | NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id ? String(session.user.id) : '';
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSafeUserId(userId)) {
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 });
  }
  const tenantId = await tenantForSession(req, userId, session?.user);
  if (tenantId instanceof NextResponse) return tenantId;
  return { userId, tenantId };
}

function getDocumentsDir(tenantId: string, userId: string): string {
  return path.join(USER_ROOT, tenantId, userId, 'Documents');
}

function getLegacyDocumentsDir(userId: string): string {
  return path.join(USER_ROOT, userId, 'Documents');
}

function getReadableDocumentsDirs(tenantId: string, userId: string): string[] {
  const dirs = [getDocumentsDir(tenantId, userId), getLegacyDocumentsDir(userId)];
  return Array.from(new Set(dirs.map(dir => path.resolve(dir))));
}

const DIARY_DIR_NAME = 'pearl-diary';
const DIARY_ID_PREFIX = 'diary--';
const DB_ID_PREFIX = 'db-';
const NOTE_META_FILENAME = '.pearlos-notes-meta.json';
type NoteMode = 'personal' | 'work';
type FileNoteMeta = Record<string, { mode?: NoteMode }>;

function getDiaryDir(documentsDir: string): string {
  return path.join(documentsDir, DIARY_DIR_NAME);
}

function resolveNotePath(documentsDir: string, id: string): string | null {
  const normalized = id.trim().replace(/^\/+/, '').replace(/\.md$/i, '');
  if (!normalized || normalized.split(/[\\/]+/).some(part => !part || part === '.' || part === '..')) return null;
  const filePath = path.resolve(documentsDir, `${normalized}.md`);
  const root = path.resolve(documentsDir);
  if (!isInside(filePath, root) || filePath === root) return null;
  return filePath;
}

function findExistingNoteFile(documentsDirs: string[], id: string): { documentsDir: string; filePath: string } | null {
  for (const dir of documentsDirs) {
    const filePath = resolveNotePath(dir, id);
    if (filePath && fs.existsSync(filePath)) {
      return { documentsDir: dir, filePath };
    }
  }
  return null;
}

function resolveDiaryPath(diaryDir: string, id: string): string | null {
  if (!id.startsWith(DIARY_ID_PREFIX)) return null;
  const basename = id.slice(DIARY_ID_PREFIX.length);
  const filename = sanitizeFilename(basename);
  if (!filename || filename !== basename) return null;
  const filePath = path.resolve(diaryDir, `${filename}.md`);
  const root = path.resolve(diaryDir);
  if (!isInside(filePath, root) || filePath === root) return null;
  return filePath;
}

function dbBlockIdFromNoteId(id: string): string {
  if (!id.startsWith(DB_ID_PREFIX)) return '';
  const blockId = id.slice(DB_ID_PREFIX.length).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(blockId) ? blockId : '';
}

function assertScopedFile(root: string, filePath: string): void {
  const rootReal = fs.realpathSync(root);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('invalid_note_path');
  }
  const fileReal = fs.realpathSync(filePath);
  if (!isInside(fileReal, rootReal) || fileReal === rootReal) {
    throw new Error('invalid_note_path');
  }
}

function notesMetaPath(documentsDir: string): string {
  return path.join(documentsDir, NOTE_META_FILENAME);
}

function readFileNoteMeta(documentsDir: string): FileNoteMeta {
  try {
    const metaPath = notesMetaPath(documentsDir);
    if (!fs.existsSync(metaPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as FileNoteMeta : {};
  } catch {
    return {};
  }
}

function writeFileNoteMeta(documentsDir: string, meta: FileNoteMeta): void {
  fs.writeFileSync(notesMetaPath(documentsDir), JSON.stringify(meta, null, 2), 'utf-8');
}

function normalizeMode(value: unknown): NoteMode {
  return value === 'work' ? 'work' : 'personal';
}

function fileNoteMode(documentsDir: string, basename: string): NoteMode {
  return normalizeMode(readFileNoteMeta(documentsDir)[basename]?.mode);
}

function setFileNoteMode(documentsDir: string, basename: string, mode: unknown): void {
  const meta = readFileNoteMeta(documentsDir);
  meta[basename] = { ...(meta[basename] || {}), mode: normalizeMode(mode) };
  writeFileNoteMeta(documentsDir, meta);
}

function moveFileNoteMeta(documentsDir: string, fromBasename: string, toBasename: string): void {
  if (fromBasename === toBasename) return;
  const meta = readFileNoteMeta(documentsDir);
  if (!meta[fromBasename]) return;
  meta[toBasename] = meta[fromBasename];
  delete meta[fromBasename];
  writeFileNoteMeta(documentsDir, meta);
}

function removeFileNoteMeta(documentsDir: string, basename: string): void {
  const meta = readFileNoteMeta(documentsDir);
  if (!meta[basename]) return;
  delete meta[basename];
  writeFileNoteMeta(documentsDir, meta);
}

function dbRowToNote(
  row: { block_id: string; content: DbNoteContent; createdAt: string; updatedAt: string },
  userId: string,
  tenantId: string,
): ApiNote {
  const c = row.content as DbNoteContent;
  return {
    _id: `${DB_ID_PREFIX}${row.block_id}`,
    title: c.title || 'Untitled',
    content: c.content || '',
    mode: (c.mode || 'personal') as 'personal' | 'work',
    filePath: undefined,
    fileName: undefined,
    userId,
    tenantId,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    isPinned: false,
    source: 'database' as const,
  };
}

function diaryFileToNote(filePath: string, documentsDir: string, userId: string, tenantId: string): ApiNote {
  assertScopedFile(documentsDir, filePath);
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const basename = path.basename(filePath, '.md');
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const title = headingMatch ? headingMatch[1].trim() : basename.replace(/-/g, ' ');
  return {
    _id: `${DIARY_ID_PREFIX}${basename}`,
    title,
    content,
    mode: 'personal' as const,
    filePath: relativePath(documentsDir, filePath),
    fileName: path.basename(filePath),
    userId,
    tenantId,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    isPinned: false,
    isDiary: true as const,
  };
}

async function fetchDbNotesOnce(userId: string, tenantId: string): Promise<ApiNote[]> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT block_id, content, "createdAt", "updatedAt"
     FROM notion_blocks
     WHERE type = 'Notes'
       AND content->>'userId' = $1
       AND content->>'tenantId' = $2
     ORDER BY "updatedAt" DESC`,
    [userId, tenantId]
  );
  return result.rows.map((row: { block_id: string; content: DbNoteContent; createdAt: string; updatedAt: string }) => dbRowToNote(row, userId, tenantId));
}

async function fetchDbNotes(userId: string, tenantId: string): Promise<ApiNote[]> {
  // Retry up to 3 times on connection failure (handles pool cold-start / transient errors)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const notes = await fetchDbNotesOnce(userId, tenantId);
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

function ensureDocumentsDir(documentsDir: string) {
  if (!fs.existsSync(documentsDir)) {
    fs.mkdirSync(documentsDir, { recursive: true });
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

function contentWithTitleHeading(content: string, title: string): string {
  const headingTitle = title.replace(/\s+/g, ' ').trim();
  if (!headingTitle) return content;
  if (/^#\s+.*$/m.test(content)) {
    return content.replace(/^#\s+.*$/m, `# ${headingTitle}`);
  }
  return `# ${headingTitle}\n\n${content}`;
}

function fileToNote(filePath: string, documentsDir: string, userId: string, tenantId: string): ApiNote {
  assertScopedFile(documentsDir, filePath);
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
    mode: fileNoteMode(documentsDir, basename),
    filePath: relativePath(documentsDir, filePath),
    fileName: path.basename(filePath),
    userId,
    tenantId,
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
  const auth = await requireSessionUser(req);
  if (auth instanceof NextResponse) return auth;
  const documentsDir = getDocumentsDir(auth.tenantId, auth.userId);
  const readableDocumentsDirs = getReadableDocumentsDirs(auth.tenantId, auth.userId);
  ensureDocumentsDir(documentsDir);
  
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  
  if (id) {
    // Check diary entry first (id format: diary--<basename>)
    if (id.startsWith(DIARY_ID_PREFIX)) {
      const diaryDir = getDiaryDir(documentsDir);
      const diaryPath = resolveDiaryPath(diaryDir, id);
      if (diaryPath && fs.existsSync(diaryPath)) {
        return NextResponse.json(diaryFileToNote(diaryPath, documentsDir, auth.userId, auth.tenantId));
      }
      return NextResponse.json({ error: 'Diary entry not found' }, { status: 404 });
    }
    // Check file-based note first, including the legacy per-user Documents folder.
    const existingFile = findExistingNoteFile(readableDocumentsDirs, id);
    if (existingFile) {
      const note = fileToNote(existingFile.filePath, existingFile.documentsDir, auth.userId, auth.tenantId);
      return NextResponse.json(note);
    }
    // Check database note (id format: db-<block_id>)
    if (id.startsWith(DB_ID_PREFIX)) {
      const blockId = dbBlockIdFromNoteId(id);
      if (!blockId) {
        return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
      }
      try {
        const pool = getDbPool();
        const result = await pool.query(
          `SELECT block_id, content, "createdAt", "updatedAt"
           FROM notion_blocks
           WHERE type = 'Notes'
             AND block_id = $1
             AND content->>'userId' = $2
             AND content->>'tenantId' = $3
           LIMIT 1`,
          [blockId, auth.userId, auth.tenantId]
        );
        if (result.rows.length > 0) {
          return NextResponse.json(dbRowToNote(result.rows[0], auth.userId, auth.tenantId));
        }
      } catch (err) {
        console.error('[notes/files] DB lookup error:', err);
      }
    }
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }
  
  try {
    // 1. File-based notes
    const files = readableDocumentsDirs.flatMap(dir => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(dirent => dirent.isFile() && !dirent.isSymbolicLink() && dirent.name.endsWith('.md'))
        .map(dirent => ({ filePath: path.join(dir, dirent.name), documentsDir: dir }));
    });
    
    const fileNotes = files.map(({ filePath, documentsDir: noteDocumentsDir }) => {
      try { return fileToNote(filePath, noteDocumentsDir, auth.userId, auth.tenantId); } catch { return null; }
    }).filter(Boolean) as ApiNote[];
    const seenFileIds = new Set<string>();
    const uniqueFileNotes = fileNotes.filter(note => {
      if (seenFileIds.has(note._id)) return false;
      seenFileIds.add(note._id);
      return true;
    });

    // 1b. Diary entries from pearl-diary/ subfolder
    const diaryDir = getDiaryDir(documentsDir);
    let diaryNotes: ApiNote[] = [];
    if (fs.existsSync(diaryDir)) {
      try {
        diaryNotes = fs.readdirSync(diaryDir, { withFileTypes: true })
          .filter(dirent => dirent.isFile() && !dirent.isSymbolicLink() && dirent.name.endsWith('.md'))
          .map(dirent => {
            try { return diaryFileToNote(path.join(diaryDir, dirent.name), documentsDir, auth.userId, auth.tenantId); } catch { return null; }
          })
          .filter(Boolean) as ApiNote[];
      } catch (err) {
        console.error('[notes/files] Failed to read diary dir:', err);
      }
    }

    // 2. Database notes — fetch and merge with file notes
    const dbNotes = await fetchDbNotes(auth.userId, auth.tenantId);
    
    // Deduplicate: if a DB note has the exact same title as a file note,
    // keep only the file version (filesystem is canonical).
    // Use a Set for O(1) lookups.
    const fileTitles = new Set(uniqueFileNotes.map(n => n.title.toLowerCase().trim()));
    const uniqueDbNotes = dbNotes.filter(
      n => !fileTitles.has(n.title.toLowerCase().trim())
    );

    console.info(`[notes/files] Merged: ${uniqueFileNotes.length} file notes + ${uniqueDbNotes.length} DB notes (${dbNotes.length} total DB, ${dbNotes.length - uniqueDbNotes.length} deduped by title)`);

    // 3. Merge: diary entries first (chronological, newest first), then file notes,
    //    then unique DB notes. Diary entries carry `isDiary: true` for UI grouping.
    diaryNotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    let notes: ApiNote[] = [...diaryNotes, ...uniqueFileNotes, ...uniqueDbNotes];

    // Filter by title if provided
    if (title) {
      const normalizedTitle = title.trim().toLowerCase();
      notes = notes.filter(n => n && n.title.toLowerCase().includes(normalizedTitle));
    }

    // Sort non-diary notes by updated date (newest first); diary entries stay
    // grouped at the top in chronological (newest-first) order.
    const diary = notes.filter(n => (n as { isDiary?: boolean }).isDiary);
    const rest = notes.filter(n => !(n as { isDiary?: boolean }).isDiary);
    rest.sort((a, b) => new Date(b!.updatedAt).getTime() - new Date(a!.updatedAt).getTime());

    return NextResponse.json([...diary, ...rest]);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read documents' }, { status: 500 });
  }
}

/**
 * POST /api/notes/files - Create a new note
 * Body: { title: string, content?: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireSessionUser(req);
  if (auth instanceof NextResponse) return auth;
  const documentsDir = getDocumentsDir(auth.tenantId, auth.userId);
  ensureDocumentsDir(documentsDir);
  
  try {
    const { title, content = '', mode = 'personal' } = await req.json();
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    
    let filename = sanitizeFilename(title);
    if (!filename) filename = `note-${Date.now()}`;
    
    // Ensure unique filename
    let filePath = path.join(documentsDir, `${filename}.md`);
    let counter = 1;
    while (fs.existsSync(filePath)) {
      filePath = path.join(documentsDir, `${filename}-${counter}.md`);
      counter++;
    }
    
    // If content doesn't start with a heading, prepend the title as H1
    let finalContent = content;
    if (!content.match(/^#\s+/m)) {
      finalContent = `# ${title}\n\n${content}`;
    }
    
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    setFileNoteMode(documentsDir, path.basename(filePath, '.md'), mode);
    
    const note = fileToNote(filePath, documentsDir, auth.userId, auth.tenantId);
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
  const auth = await requireSessionUser(req);
  if (auth instanceof NextResponse) return auth;
  const documentsDir = getDocumentsDir(auth.tenantId, auth.userId);
  ensureDocumentsDir(documentsDir);
  
  try {
    const { id, title, content, mode } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    if (String(id).startsWith(DIARY_ID_PREFIX)) {
      const diaryDir = getDiaryDir(documentsDir);
      const diaryPath = resolveDiaryPath(diaryDir, String(id));
      if (!diaryPath) {
        return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
      }
      if (!fs.existsSync(diaryPath)) {
        return NextResponse.json({ error: 'Diary entry not found' }, { status: 404 });
      }
      assertScopedFile(documentsDir, diaryPath);

      let nextContent = content !== undefined ? String(content) : undefined;
      if (title !== undefined) {
        const currentContent = nextContent !== undefined ? nextContent : fs.readFileSync(diaryPath, 'utf-8');
        nextContent = contentWithTitleHeading(currentContent, String(title));
      }
      if (nextContent !== undefined) {
        fs.writeFileSync(diaryPath, nextContent, 'utf-8');
      }

      let finalPath = diaryPath;
      if (title !== undefined) {
        const newFilename = sanitizeFilename(String(title));
        if (newFilename) {
          const newPath = path.join(diaryDir, `${newFilename}.md`);
          if (isInside(newPath, diaryDir) && newPath !== diaryPath && !fs.existsSync(newPath)) {
            fs.renameSync(diaryPath, newPath);
            finalPath = newPath;
          }
        }
      }

      return NextResponse.json(diaryFileToNote(finalPath, documentsDir, auth.userId, auth.tenantId));
    }

    if (String(id).startsWith(DB_ID_PREFIX)) {
      const blockId = dbBlockIdFromNoteId(String(id));
      if (!blockId) {
        return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
      }
      const updates: Record<string, unknown> = {};
      if (title !== undefined) {
        const nextTitle = String(title);
        updates.title = nextTitle;
        updates.normalizedTitle = nextTitle.trim().toLowerCase();
      }
      if (content !== undefined) updates.content = String(content);
      if (mode === 'personal' || mode === 'work') updates.mode = mode;

      const pool = getDbPool();
      const result = await pool.query(
        `UPDATE notion_blocks
         SET content = content || $1::jsonb,
             "updatedAt" = NOW()
         WHERE type = 'Notes'
           AND block_id = $2
           AND content->>'userId' = $3
           AND content->>'tenantId' = $4
         RETURNING block_id, content, "createdAt", "updatedAt"`,
        [JSON.stringify(updates), blockId, auth.userId, auth.tenantId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      }
      return NextResponse.json(dbRowToNote(result.rows[0], auth.userId, auth.tenantId));
    }
    
    const existingFile = findExistingNoteFile(getReadableDocumentsDirs(auth.tenantId, auth.userId), String(id));
    if (!existingFile) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    const { documentsDir: noteDocumentsDir, filePath } = existingFile;
    assertScopedFile(noteDocumentsDir, filePath);
    
    let nextContent = content !== undefined ? String(content) : undefined;
    if (title !== undefined) {
      const currentContent = nextContent !== undefined ? nextContent : fs.readFileSync(filePath, 'utf-8');
      nextContent = contentWithTitleHeading(currentContent, String(title));
    }
    if (nextContent !== undefined) {
      fs.writeFileSync(filePath, nextContent, 'utf-8');
    }
    
    // Handle rename if title changed and it implies a different filename
    let finalPath = filePath;
    const originalBasename = path.basename(filePath, '.md');
    if (title !== undefined) {
      const newFilename = sanitizeFilename(title);
      if (newFilename && newFilename !== id) {
        const newPath = path.join(noteDocumentsDir, `${newFilename}.md`);
        if (isInside(newPath, noteDocumentsDir) && !fs.existsSync(newPath)) {
          fs.renameSync(filePath, newPath);
          finalPath = newPath;
          moveFileNoteMeta(noteDocumentsDir, originalBasename, newFilename);
        }
      }
    }
    if (mode === 'personal' || mode === 'work') {
      setFileNoteMode(noteDocumentsDir, path.basename(finalPath, '.md'), mode);
    }
    
    const note = fileToNote(finalPath, noteDocumentsDir, auth.userId, auth.tenantId);
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
  const auth = await requireSessionUser(req);
  if (auth instanceof NextResponse) return auth;
  const documentsDir = getDocumentsDir(auth.tenantId, auth.userId);
  ensureDocumentsDir(documentsDir);
  
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    if (String(id).startsWith(DIARY_ID_PREFIX)) {
      const diaryDir = getDiaryDir(documentsDir);
      const diaryPath = resolveDiaryPath(diaryDir, String(id));
      if (!diaryPath) {
        return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
      }
      if (!fs.existsSync(diaryPath)) {
        return NextResponse.json({ error: 'Diary entry not found' }, { status: 404 });
      }
      assertScopedFile(documentsDir, diaryPath);

      const trashDir = path.join(documentsDir, '.trash', DIARY_DIR_NAME);
      if (!fs.existsSync(trashDir)) {
        fs.mkdirSync(trashDir, { recursive: true });
      }
      const basename = path.basename(diaryPath, '.md');
      const trashPath = path.join(trashDir, `${basename}-${Date.now()}.md`);
      fs.renameSync(diaryPath, trashPath);

      return NextResponse.json({
        message: 'Diary entry deleted',
        deletedId: String(id),
        trashedTo: relativePath(documentsDir, trashPath),
      });
    }

    if (String(id).startsWith(DB_ID_PREFIX)) {
      const blockId = dbBlockIdFromNoteId(String(id));
      if (!blockId) {
        return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
      }
      const pool = getDbPool();
      const result = await pool.query(
        `DELETE FROM notion_blocks
         WHERE type = 'Notes'
           AND block_id = $1
           AND content->>'userId' = $2
           AND content->>'tenantId' = $3
         RETURNING block_id`,
        [blockId, auth.userId, auth.tenantId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      }
      return NextResponse.json({ message: 'Note deleted', deletedId: `${DB_ID_PREFIX}${blockId}` });
    }
    
    const existingFile = findExistingNoteFile(getReadableDocumentsDirs(auth.tenantId, auth.userId), String(id));
    if (!existingFile) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    const { documentsDir: noteDocumentsDir, filePath } = existingFile;
    assertScopedFile(noteDocumentsDir, filePath);
    
    // Move to trash instead of permanent delete
    const trashDir = path.join(noteDocumentsDir, '.trash');
    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true });
    }
    const trashPath = path.join(trashDir, `${id}-${Date.now()}.md`);
    fs.renameSync(filePath, trashPath);
    removeFileNoteMeta(noteDocumentsDir, path.basename(filePath, '.md'));
    
    return NextResponse.json({ message: 'Note deleted', trashedTo: relativePath(noteDocumentsDir, trashPath) });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
}
