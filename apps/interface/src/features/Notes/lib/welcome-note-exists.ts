import fs from 'fs';
import path from 'path';

import { NotesDefinition } from '@interface/features/Notes';
import { getLogger } from '@interface/lib/logger';

import { WELCOME_NOTE_TITLE } from './welcome-note';

const log = getLogger('Notes:WelcomeExists');

type PrismClient = {
  query: (query: Record<string, unknown>) => Promise<{ items?: unknown[] }>;
};

function normalizedTitle(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function noteTitleMatchesWelcome(item: Record<string, unknown>): boolean {
  const title = String(item.title || '').trim();
  const indexedTitle = normalizedTitle(item.normalizedTitle);
  return title === WELCOME_NOTE_TITLE || indexedTitle === normalizedTitle(WELCOME_NOTE_TITLE);
}

function isSafePathSegment(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function userRoot(): string {
  return process.env.PEARLOS_USER_ROOT || '/workspace/user';
}

function documentsDir(tenantId: string, userId: string): string | null {
  if (!isSafePathSegment(tenantId) || !isSafePathSegment(userId)) return null;
  return path.join(userRoot(), tenantId, userId, 'Documents');
}

function titleFromMarkdown(content: string, basename: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch ? headingMatch[1].trim() : basename.replace(/-/g, ' ');
}

async function dbWelcomeNoteExists(prism: PrismClient, userId: string, tenantId: string): Promise<boolean> {
  const ownerClauses = [
    { parent_id: { eq: userId } },
    { indexer: { path: 'userId', equals: userId } },
  ];
  const titleClauses = [
    { indexer: { path: 'normalizedTitle', equals: normalizedTitle(WELCOME_NOTE_TITLE) } },
    { indexer: { path: 'title', equals: WELCOME_NOTE_TITLE } },
  ];

  const queries = ownerClauses.flatMap((ownerClause) => titleClauses.map((titleClause) => ({
    contentType: NotesDefinition.dataModel.block,
    where: { AND: [ownerClause, titleClause] },
    limit: 10,
    tenantId,
  })));

  const results = await Promise.all(
    queries.map((query) => prism.query(query).catch((error) => {
      log.warn('Welcome note duplicate check query failed', { userId, tenantId, error });
      return { items: [] };
    })),
  );

  return results.some((result) => {
    const items = Array.isArray(result.items) ? result.items : [];
    return items.some((item) => noteTitleMatchesWelcome(item as Record<string, unknown>));
  });
}

function fileWelcomeNoteExists(userId: string, tenantId: string): boolean {
  const dir = documentsDir(tenantId, userId);
  if (!dir || !fs.existsSync(dir)) return false;

  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((dirent) => {
      if (!dirent.isFile() || dirent.isSymbolicLink() || !dirent.name.endsWith('.md')) return false;
      const filePath = path.join(dir, dirent.name);
      const content = fs.readFileSync(filePath, 'utf-8');
      const basename = path.basename(dirent.name, '.md');
      return noteTitleMatchesWelcome({ title: titleFromMarkdown(content, basename) });
    });
  } catch (error) {
    log.warn('Welcome note filesystem duplicate check failed', { userId, tenantId, error });
    return false;
  }
}

export async function welcomeNoteExistsForUser(
  prism: PrismClient,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const [existsInDb, existsInFiles] = await Promise.all([
    dbWelcomeNoteExists(prism, userId, tenantId),
    Promise.resolve(fileWelcomeNoteExists(userId, tenantId)),
  ]);
  return existsInDb || existsInFiles;
}
