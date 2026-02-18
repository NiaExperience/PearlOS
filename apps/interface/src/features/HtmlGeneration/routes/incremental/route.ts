/**
 * Incremental HtmlGeneration (Applets) API Route
 * 
 * Streams applets in batches for faster perceived loading:
 * 1. personal - user's own applets
 * 2. shared-to-user - applets shared via organization membership
 * 3. shared-to-all - applets from sharedToAllReadOnly organizations
 * 
 * Supports Server-Sent Events (SSE) for true streaming or JSON batches.
 * 
 * @route GET /api/html-generation/incremental
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { AssistantActions, TenantActions } from '@nia/prism/core/actions';
import { getUserSharedResources } from '@nia/prism/core/actions/organization-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextRequest, NextResponse } from 'next/server';

import {
  findHtmlContentsByIds,
  listHtmlGenerations,
} from '@interface/features/HtmlGeneration/actions/html-generation-actions';
import { HtmlContent } from '@interface/features/HtmlGeneration/types/html-generation-types';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';

const log = getLogger('[html-generation.incremental]');

type BatchType = 'personal' | 'shared-to-user' | 'shared-to-all';

interface AppletBatch {
  batch: BatchType;
  items: HtmlContent[];
  done: boolean;
  error?: string;
}

/**
 * GET /api/html-generation/incremental
 * 
 * Query params:
 * - agent: Assistant name (required)
 * - userId: Target user ID (optional, requires admin)
 * - limit: Max items per batch (default: 50)
 * - stream: 'true' for SSE, 'false' for JSON (default: 'true')
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Auth
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionUserId = session.user.id;
    // Use the session ID from the session object if available, otherwise fallback to user ID
    // This ensures logs are correlated with the correct session
    const sessionId = (session.user as any)?.sessionId ?? sessionUserId;
    const userName = (session.user as any)?.name ?? (session.user as any)?.email ?? 'unknown';
    setLogContext({ sessionId, userId: sessionUserId, userName, tag: 'html-generation.incremental' });

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const assistantName = searchParams.get('agent') || searchParams.get('assistantName');
    const userIdParam = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const useStream = searchParams.get('stream') !== 'false';

    if (!assistantName) {
      return NextResponse.json({ error: 'Missing agent parameter' }, { status: 400 });
    }

    // Get tenant from assistant
    let assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
    if (!assistant) {
      assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
    }
    if (!assistant?.tenantId) {
      return NextResponse.json({ error: 'Assistant not found' }, { status: 404 });
    }
    const tenantId = assistant.tenantId;

    // Determine target user (admin can view other users)
    let targetUserId = sessionUserId;
    if (userIdParam && userIdParam !== sessionUserId) {
      const isAdmin = await TenantActions.userHasAccess(sessionUserId, tenantId, TenantRole.ADMIN);
      if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      targetUserId = userIdParam;
    }

    log.info('Incremental applets fetch started', { targetUserId, tenantId, limit, useStream });

    if (useStream) {
      return createSSEResponse(targetUserId, tenantId, limit);
    } else {
      return createJSONResponse(targetUserId, tenantId, limit);
    }
  } catch (error) {
    log.error('Incremental applets fetch error', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Create Server-Sent Events streaming response
 */
function createSSEResponse(userId: string, tenantId: string, limit: number): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendBatch = (batch: AppletBatch) => {
        const data = `data: ${JSON.stringify(batch)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      try {
        // Batch 1: Personal applets
        try {
          const personalApplets = await listHtmlGenerations({
            userId,
            tenantId,
            limit,
          });
          log.debug('Fetched personal applets', { count: personalApplets.length });
          sendBatch({ batch: 'personal', items: personalApplets, done: false });
        } catch (err) {
          log.error('Error fetching personal applets', { err });
          sendBatch({ batch: 'personal', items: [], done: false, error: 'Failed to load personal applets' });
        }

        // Batch 2 & 3: Shared applets
        try {
          const sharedResources = await getUserSharedResources(userId, tenantId, 'HtmlGeneration');
          log.debug('Fetched shared resources', { count: sharedResources.length });

          // Separate shared-to-user vs shared-to-all
          const sharedToUser = sharedResources.filter(r => !r.organization?.sharedToAllReadOnly);
          const sharedToAll = sharedResources.filter(r => r.organization?.sharedToAllReadOnly);

          // Batch 2: Shared to user
          if (sharedToUser.length > 0) {
            const sharedToUserApplets = await batchFetchApplets(sharedToUser, tenantId);
            sendBatch({ batch: 'shared-to-user', items: sharedToUserApplets, done: false });
          } else {
            sendBatch({ batch: 'shared-to-user', items: [], done: false });
          }

          // Batch 3: Shared to all (final batch)
          if (sharedToAll.length > 0) {
            const sharedToAllApplets = await batchFetchApplets(sharedToAll, tenantId);
            sendBatch({ batch: 'shared-to-all', items: sharedToAllApplets, done: true });
          } else {
            sendBatch({ batch: 'shared-to-all', items: [], done: true });
          }
        } catch (err) {
          log.error('Error fetching shared applets', { err });
          sendBatch({ batch: 'shared-to-user', items: [], done: false, error: 'Failed to load shared applets' });
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
async function createJSONResponse(userId: string, tenantId: string, limit: number): Promise<NextResponse> {
  const batches: AppletBatch[] = [];
  const allItems: HtmlContent[] = [];
  const seenIds = new Set<string>();

  const addBatch = (batch: AppletBatch) => {
    batches.push(batch);
    for (const item of batch.items) {
      const id = (item as any)._id || (item as any).page_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allItems.push(item);
      }
    }
  };

  try {
    // Personal
    const personalApplets = await listHtmlGenerations({ userId, tenantId, limit });
    addBatch({ batch: 'personal', items: personalApplets, done: false });

    // Shared
    const sharedResources = await getUserSharedResources(userId, tenantId, 'HtmlGeneration');
    const sharedToUser = sharedResources.filter(r => !r.organization?.sharedToAllReadOnly);
    const sharedToAll = sharedResources.filter(r => r.organization?.sharedToAllReadOnly);

    if (sharedToUser.length > 0) {
      const applets = await batchFetchApplets(sharedToUser, tenantId);
      addBatch({ batch: 'shared-to-user', items: applets, done: false });
    } else {
      addBatch({ batch: 'shared-to-user', items: [], done: false });
    }

    if (sharedToAll.length > 0) {
      const applets = await batchFetchApplets(sharedToAll, tenantId);
      addBatch({ batch: 'shared-to-all', items: applets, done: true });
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

  log.info('Incremental applets fetch complete', { totalItems: allItems.length, batchCount: batches.length });

  return NextResponse.json({
    success: true,
    batches,
    items: allItems,
    total: allItems.length,
  });
}

/**
 * Batch fetch applets with sharing metadata and owner info
 */
async function batchFetchApplets(
  sharedResources: Array<{ resourceId: string; organization: any; role: any }>,
  fallbackTenantId: string
): Promise<HtmlContent[]> {
  if (sharedResources.length === 0) return [];

  // Group by tenant for efficient queries
  const resourcesByTenant = new Map<string, Array<{ resourceId: string; organization: any; role: any }>>();
  
  for (const resource of sharedResources) {
    const orgTenantId = resource.organization?.tenantId || fallbackTenantId;
    if (!resourcesByTenant.has(orgTenantId)) {
      resourcesByTenant.set(orgTenantId, []);
    }
    resourcesByTenant.get(orgTenantId)!.push(resource);
  }

  // Cache for owner lookups
  const ownerCache = new Map<string, string>();
  const results: HtmlContent[] = [];

  // Fetch from each tenant in parallel
  const fetchPromises = Array.from(resourcesByTenant.entries()).map(
    async ([orgTenantId, resources]) => {
      try {
        const ids = resources.map(r => r.resourceId);
        const applets = await findHtmlContentsByIds(ids, orgTenantId);
        
        // Create a map for quick lookup
        const appletMap = new Map(
          applets.map(a => [(a as any)._id || (a as any).page_id, a])
        );

        // Enrich with sharing metadata
        const enriched: HtmlContent[] = [];
        
        for (const resource of resources) {
          const applet = appletMap.get(resource.resourceId);
          if (!applet) continue;

          // Get owner display name
          const ownerId = resource.organization?.settings?.resourceOwnerUserId as string | undefined;
          let ownerDisplayName = 'Unknown';

          if (ownerId) {
            if (ownerCache.has(ownerId)) {
              ownerDisplayName = ownerCache.get(ownerId)!;
            } else {
              try {
                const owner = await getUserById(ownerId);
                ownerDisplayName = owner?.name || owner?.email || ownerId;
                ownerCache.set(ownerId, ownerDisplayName);
              } catch {
                // Keep default
              }
            }
          }

          enriched.push({
            ...applet,
            sharedVia: {
              organization: resource.organization,
              role: resource.role,
              ownerEmail: ownerDisplayName,
            },
          } as HtmlContent);
        }

        return enriched;
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
