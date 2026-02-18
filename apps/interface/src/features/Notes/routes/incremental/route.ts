/**
 * Incremental Notes API Route
 * 
 * Streams notes in batches for faster perceived loading:
 * 1. personal - user's own personal notes
 * 2. work - user's own work notes  
 * 3. shared-to-user - notes shared via organization membership
 * 4. shared-to-all - notes from sharedToAllReadOnly organizations
 * 
 * Supports Server-Sent Events (SSE) for true streaming or JSON batches.
 * 
 * @route GET /api/notes/incremental
 */

import { AssistantActions } from '@nia/prism/core/actions';
import { getUserSharedResources } from '@nia/prism/core/actions/organization-actions';
import { NextRequest, NextResponse } from 'next/server';

import { findNotesByIds, findNotesByUserId } from '@interface/features/Notes/actions/notes-actions';
import { Note } from '@interface/features/Notes/types/notes-types';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { getNotesSession } from '../notes-auth';

const log = getLogger('[notes.incremental]');

type BatchType = 'personal' | 'work' | 'shared-to-user' | 'shared-to-all';

interface NoteBatch {
  batch: BatchType;
  items: Note[];
  done: boolean;
  error?: string;
}

/**
 * GET /api/notes/incremental
 * 
 * Query params:
 * - agent: Assistant name (required)
 * - mode: 'personal' | 'work' | 'all' (default: 'all')
 * - stream: 'true' for SSE, 'false' for JSON (default: 'true')
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Auth
    const session = await getNotesSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    // Use the session ID from the session object if available, otherwise fallback to user ID
    // This ensures logs are correlated with the correct session
    const sessionId = (session.user as any)?.sessionId ?? userId;
    const userName = (session.user as any)?.name ?? (session.user as any)?.email ?? 'unknown';
    setLogContext({ sessionId, userId, userName, tag: 'notes.incremental' });

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const assistantName = searchParams.get('agent');
    const mode = searchParams.get('mode') || 'all';
    const useStream = searchParams.get('stream') !== 'false';

    if (!assistantName) {
      return NextResponse.json({ error: 'Missing agent parameter' }, { status: 400 });
    }

    // Get tenant from assistant
    const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
    if (!assistant?.tenantId) {
      return NextResponse.json({ error: 'Assistant not found' }, { status: 404 });
    }
    const tenantId = assistant.tenantId;

    log.info('Incremental notes fetch started', { userId, tenantId, mode, useStream });

    if (useStream) {
      // SSE streaming response
      return createSSEResponse(userId, tenantId, mode);
    } else {
      // Standard JSON response with all batches
      return createJSONResponse(userId, tenantId, mode);
    }
  } catch (error) {
    log.error('Incremental notes fetch error', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Create Server-Sent Events streaming response
 */
function createSSEResponse(userId: string, tenantId: string, mode: string): Response {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendBatch = (batch: NoteBatch) => {
        const data = `data: ${JSON.stringify(batch)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      try {
        // Fetch personal, work, and shared resources in parallel for speed
        const [personalResult, workResult, sharedResult] = await Promise.allSettled([
          (mode === 'all' || mode === 'personal')
            ? findNotesByUserId(userId, tenantId, 'personal')
            : Promise.resolve(null),
          (mode === 'all' || mode === 'work')
            ? findNotesByUserId(userId, tenantId, 'work')
            : Promise.resolve(null),
          getUserSharedResources(userId, tenantId, 'Notes'),
        ]);

        // Batch 1: Personal notes
        if (mode === 'all' || mode === 'personal') {
          if (personalResult.status === 'fulfilled' && personalResult.value) {
            log.debug('Fetched personal notes', { count: personalResult.value.length });
            sendBatch({ batch: 'personal', items: personalResult.value, done: false });
          } else {
            const err = personalResult.status === 'rejected' ? personalResult.reason : undefined;
            log.error('Error fetching personal notes', { err });
            sendBatch({ batch: 'personal', items: [], done: false, error: 'Failed to load personal notes' });
          }
        }

        // Batch 2: Work notes
        if (mode === 'all' || mode === 'work') {
          if (workResult.status === 'fulfilled' && workResult.value) {
            log.debug('Fetched work notes', { count: workResult.value.length });
            sendBatch({ batch: 'work', items: workResult.value, done: false });
          } else {
            const err = workResult.status === 'rejected' ? workResult.reason : undefined;
            log.error('Error fetching work notes', { err });
            sendBatch({ batch: 'work', items: [], done: false, error: 'Failed to load work notes' });
          }
        }

        // Batch 3 & 4: Shared notes (to-user and to-all)
        try {
          const sharedResources = sharedResult.status === 'fulfilled' ? sharedResult.value : [];
          if (sharedResult.status === 'rejected') {
            throw sharedResult.reason;
          }
          log.debug('Fetched shared resources', { count: sharedResources.length });

          // Separate shared-to-user vs shared-to-all
          const sharedToUser: typeof sharedResources = [];
          const sharedToAll: typeof sharedResources = [];

          for (const resource of sharedResources) {
            if (resource.organization?.sharedToAllReadOnly) {
              sharedToAll.push(resource);
            } else {
              sharedToUser.push(resource);
            }
          }

          // Batch 3: Shared to user
          if (sharedToUser.length > 0) {
            const sharedToUserIds = sharedToUser.map(r => r.resourceId);
            const sharedToUserNotes = await batchFetchNotes(sharedToUserIds, tenantId, sharedToUser);
            sendBatch({ batch: 'shared-to-user', items: sharedToUserNotes, done: false });
          } else {
            sendBatch({ batch: 'shared-to-user', items: [], done: false });
          }

          // Batch 4: Shared to all (final batch)
          if (sharedToAll.length > 0) {
            const sharedToAllIds = sharedToAll.map(r => r.resourceId);
            const sharedToAllNotes = await batchFetchNotes(sharedToAllIds, tenantId, sharedToAll);
            sendBatch({ batch: 'shared-to-all', items: sharedToAllNotes, done: true });
          } else {
            sendBatch({ batch: 'shared-to-all', items: [], done: true });
          }
        } catch (err) {
          log.error('Error fetching shared notes', { err });
          sendBatch({ batch: 'shared-to-user', items: [], done: false, error: 'Failed to load shared notes' });
          sendBatch({ batch: 'shared-to-all', items: [], done: true });
        }

        controller.close();
      } catch (err) {
        log.error('Stream error', { err });
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Create standard JSON response with all batches
 */
async function createJSONResponse(userId: string, tenantId: string, mode: string): Promise<NextResponse> {
  const batches: NoteBatch[] = [];
  const allItems: Note[] = [];
  const seenIds = new Set<string>();

  const addBatch = (batch: NoteBatch) => {
    batches.push(batch);
    for (const item of batch.items) {
      const id = (item as any)._id || (item as any).page_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allItems.push(item);
      }
    }
  };

  // Fetch all batches in parallel
  try {
    const [personalNotes, workNotes, sharedResources] = await Promise.all([
      (mode === 'all' || mode === 'personal')
        ? findNotesByUserId(userId, tenantId, 'personal')
        : Promise.resolve([]),
      (mode === 'all' || mode === 'work')
        ? findNotesByUserId(userId, tenantId, 'work')
        : Promise.resolve([]),
      getUserSharedResources(userId, tenantId, 'Notes'),
    ]);

    // Personal
    if (mode === 'all' || mode === 'personal') {
      addBatch({ batch: 'personal', items: personalNotes, done: false });
    }

    // Work
    if (mode === 'all' || mode === 'work') {
      addBatch({ batch: 'work', items: workNotes, done: false });
    }

    // Shared (already fetched above)
    const sharedToUser = sharedResources.filter(r => !r.organization?.sharedToAllReadOnly);
    const sharedToAll = sharedResources.filter(r => r.organization?.sharedToAllReadOnly);

    if (sharedToUser.length > 0) {
      const ids = sharedToUser.map(r => r.resourceId);
      const notes = await batchFetchNotes(ids, tenantId, sharedToUser);
      addBatch({ batch: 'shared-to-user', items: notes, done: false });
    } else {
      addBatch({ batch: 'shared-to-user', items: [], done: false });
    }

    if (sharedToAll.length > 0) {
      const ids = sharedToAll.map(r => r.resourceId);
      const notes = await batchFetchNotes(ids, tenantId, sharedToAll);
      addBatch({ batch: 'shared-to-all', items: notes, done: true });
    } else {
      addBatch({ batch: 'shared-to-all', items: [], done: true });
    }
  } catch (err) {
    log.error('JSON response error', { err });
  }

  // Mark last batch as done
  if (batches.length > 0) {
    batches[batches.length - 1].done = true;
  }

  log.info('Incremental notes fetch complete', { totalItems: allItems.length, batchCount: batches.length });

  return NextResponse.json({
    success: true,
    batches,
    items: allItems,
    total: allItems.length,
  });
}

/**
 * Batch fetch notes by IDs with sharing metadata
 */
async function batchFetchNotes(
  noteIds: string[],
  tenantId: string,
  sharedResources: Array<{ resourceId: string; organization: any; role: any }>
): Promise<Note[]> {
  if (noteIds.length === 0) return [];

  // Group by tenant for efficient queries
  const resourcesByTenant = new Map<string, string[]>();
  const resourceMetadata = new Map<string, { organization: any; role: any }>();

  for (const resource of sharedResources) {
    const orgTenantId = resource.organization?.tenantId || tenantId;
    if (!resourcesByTenant.has(orgTenantId)) {
      resourcesByTenant.set(orgTenantId, []);
    }
    resourcesByTenant.get(orgTenantId)!.push(resource.resourceId);
    resourceMetadata.set(resource.resourceId, {
      organization: resource.organization,
      role: resource.role,
    });
  }

  const results: Note[] = [];

  // Fetch from each tenant in parallel
  const fetchPromises = Array.from(resourcesByTenant.entries()).map(
    async ([orgTenantId, ids]) => {
      try {
        const notes = await findNotesByIds(ids, orgTenantId);
        return notes.map((note) => {
          const id = (note as any)._id || (note as any).page_id;
          const metadata = resourceMetadata.get(id);
          return {
            ...note,
            sharedVia: metadata
              ? {
                  organization: metadata.organization,
                  role: metadata.role,
                }
              : undefined,
          };
        });
      } catch (err) {
        log.error('Batch fetch failed for tenant', { orgTenantId, err });
        return [];
      }
    }
  );

  const batchResults = await Promise.all(fetchPromises);
  for (const batch of batchResults) {
    results.push(...batch);
  }

  return results;
}

// Export for Next.js App Router
export const dynamic = 'force-dynamic';
