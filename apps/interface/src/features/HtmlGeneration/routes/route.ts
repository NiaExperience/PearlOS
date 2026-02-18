/* eslint-disable @typescript-eslint/no-explicit-any */
import { AssistantActions, TenantActions } from '@nia/prism/core/actions';
import { getAssistantByName } from '@nia/prism/core/actions/assistant-actions';
import { getUserSharedResources } from '@nia/prism/core/actions/organization-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { CreateHtmlGenerationRequest, GetHtmlGenerationRequest } from '@interface/features/HtmlGeneration//types/html-generation-types';
import {
  createHtmlGeneration,
  findHtmlContentById,
  findHtmlContentsByIds,
  listHtmlGenerations
} from '@interface/features/HtmlGeneration/actions/html-generation-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';

import { setGenerationCompleted, setGenerationStarted, setGenerationFailed } from './status/route';

const log = getLogger('[html-generation][route]');
const LOG_PREFIX = '[sprite-test] ';

/**
 * Async HTML generation function that runs in the background
 */
async function generateHtmlAsync(
  jobId: string, 
  request: CreateHtmlGenerationRequest, 
  tenantId: string, 
  _userName: string,
  userId?: string
): Promise<void> {
  log.info(`${LOG_PREFIX}generateHtmlAsync: start`, { jobId });
  
  try {
    // Update status to indicate generation has started
    const title = request.title || 'Untitled';
    await setGenerationStarted(jobId, title, tenantId, userId);
    
    // Call the existing generation function
    const htmlGeneration = await createHtmlGeneration(request);
    log.info(`${LOG_PREFIX}generateHtmlAsync: completed`, { jobId });
    
    // Mark as completed with the generated content
    const contentId = (htmlGeneration as any)?._id || (htmlGeneration as any)?.page_id || 'unknown';
    await setGenerationCompleted(jobId, contentId, title, tenantId, htmlGeneration, userId);    
  } catch (error) {
    log.error(`${LOG_PREFIX}generateHtmlAsync: failed`, { jobId, err: error, stack: error instanceof Error ? error.stack : undefined });
    await setGenerationFailed(jobId, error instanceof Error ? error.message : 'Unknown error', tenantId, userId);
  }
}

export async function GET_impl(request: NextRequest): Promise<NextResponse> {
  try {
    log.debug('GET /api/get-html-content start');
    
    const session = await getSessionSafely(request, interfaceAuthOptions);
    const sessionUser = session?.user ?? null;
    const sessionId =
      ((session as any)?.sessionId as string | null) ||
      ((sessionUser as any)?.sessionId as string | null) ||
      null;
    const sessionUserName = ((sessionUser as any)?.name as string | null) || null;
    setLogContext({ sessionId, userId: sessionUser?.id ?? null, userName: sessionUserName });
    if (!session || !session.user) {
      log.warn(`${LOG_PREFIX}GET /api/get-html-content unauthorized - no session`);
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id; // provisional tenant scoping strategy
    log.debug('GET /api/get-html-content session user', { userId });

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const title = searchParams.get('title');
    const contentType = searchParams.get('contentType') as GetHtmlGenerationRequest['contentType'];
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 10;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined;
    const userIdParam = searchParams.get('userId') || userId; // superadmin scoped
    const assistantName = searchParams.get('assistantName') || searchParams.get('agent') || undefined;

    log.debug('GET /api/get-html-content request params', { id, title, contentType, limit, offset, userIdParam, assistantName });

    if (!assistantName) {
      log.warn(`${LOG_PREFIX}GET /api/get-html-content missing assistant name`);
      return NextResponse.json({ success: false, message: 'Missing assistant name' }, { status: 400 });
    }

    // Accept either display name or subdomain; try name first, then subdomain
    log.debug('GET /api/get-html-content looking up assistant', { assistantName });
    let assistant = await getAssistantByName(assistantName);
    if (!assistant) {
      try {
        assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
      } catch (_) {
        // no-op; handled by not found below
      }
    }
    if (!assistant) {
      log.warn(`${LOG_PREFIX}GET /api/get-html-content assistant not found`, { assistantName });
      return NextResponse.json({ success: false, message: 'Assistant not found' }, { status: 404 });
    }
    const tenantId = assistant?.tenantId;
    log.debug('GET /api/get-html-content assistant found', { tenantId, assistantId: assistant._id });
    
    if (!tenantId) {
      log.warn(`${LOG_PREFIX}GET /api/get-html-content assistant has no tenantId`);
      return NextResponse.json({ success: false, message: 'Assistant has no tenantId' }, { status: 404 });
    }

    // If the incoming userId (from the UI dropdown) doesn't match
    // the session user, we check to see if the session user is an
    // admin for the tenant, and allow the session user to load the
    // target user's applets.
    const isAdmin = await TenantActions.userHasAccess(userId, tenantId, TenantRole.ADMIN);
    log.debug('GET /api/get-html-content permission check', { userId, userIdParam, isAdmin });
    
    if (userId !== userIdParam && !isAdmin) {
      log.warn(`${LOG_PREFIX}GET /api/get-html-content forbidden - mismatched user without admin`, { userId, userIdParam });
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    log.debug('GET /api/get-html-content fetching data', { id, title, contentType, limit, tenantId });

    if (id) {
      // Get specific HTML generation by ID (using correct tenant scope)
      log.debug('GET /api/get-html-content fetching by id', { id, tenantId });
      const htmlGeneration = await findHtmlContentById(id, tenantId);

      if (!htmlGeneration) {
        log.warn(`${LOG_PREFIX}GET /api/get-html-content not found`, { id, tenantId });
        return NextResponse.json(
          {
            success: false,
            message: 'HTML generation not found'
          },
          { status: 404 }
        );
      }

      log.info(`${LOG_PREFIX}GET /api/get-html-content found by id`, {
        title: (htmlGeneration as any).title,
        userId: (htmlGeneration as any).userId,
        tenantId,
        id
      });
      
      return NextResponse.json({
        success: true,
        data: {
          ...htmlGeneration,
          // Surface provider for client convenience if stored in metadata
          aiProvider: (htmlGeneration as any)?.metadata?.aiProvider || 'unknown'
        }
      });
    }

    // List HTML generations with filters
    log.debug('GET /api/get-html-content listing applets', { tenantId, userIdParam, title, limit });
    
    const htmlGenerations = await listHtmlGenerations({
      title: title || undefined,
      contentType,
      limit,
      offset,
      userId: userIdParam,
      tenantId
    });
    
    log.info(`${LOG_PREFIX}GET /api/get-html-content listed applets`, { listedCount: htmlGenerations.length });

    // Also fetch shared HTML generations
    let allHtmlGenerations = htmlGenerations;
    try {
      const sharedResources = await getUserSharedResources(userId, tenantId, 'HtmlGeneration');
      log.debug(`${LOG_PREFIX}GET HtmlGeneration shared resources lookup`, { sharedCount: sharedResources.length, tenantId, userId });

      const sharedOrgSummaries = sharedResources.map((r) => ({
        resourceId: r.resourceId,
        orgId: r.organization?._id,
        orgTenantId: r.organization?.tenantId,
        sharedToAllReadOnly: r.organization?.sharedToAllReadOnly,
        role: r.role,
        contentType: r.contentType,
      }));
      log.debug(`${LOG_PREFIX}GET HtmlGeneration shared org summaries`, { sharedOrgSummaries });

      // Group shared resources by tenant to batch queries and reduce per-resource lookups.
      const resourcesByTenant = sharedResources.reduce((acc, resource) => {
        const orgTenantId = resource.organization?.tenantId;
        if (!orgTenantId || !resource.resourceId) return acc;
        if (!acc.has(orgTenantId)) acc.set(orgTenantId, [] as typeof sharedResources);
        acc.get(orgTenantId)!.push(resource);
        return acc;
      }, new Map<string, typeof sharedResources>());

      const ownerCache = new Map<string, string>();
      const sharedHtmlGenerations: any[] = [];

      for (const [orgTenantId, resources] of resourcesByTenant.entries()) {
        try {
          const ids = Array.from(new Set(resources.map(r => r.resourceId).filter(Boolean)));
          if (!ids.length) continue;
          const htmlGenBatch = await findHtmlContentsByIds(ids, orgTenantId);
          const htmlGenMap = new Map(
            htmlGenBatch.map((item: any) => {
              const key = (item as any)._id;
              return [key, item];
            })
          );

          for (const resource of resources) {
            const htmlGen = htmlGenMap.get(resource.resourceId);
            if (!htmlGen) continue;

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
                } catch (userError) {
                  log.error(`${LOG_PREFIX}GET HtmlGeneration owner lookup failed`, { err: userError, htmlGenerationId: (htmlGen as any)._id });
                }
              }
            } else {
              log.warn(`${LOG_PREFIX}GET HtmlGeneration missing resource owner user id`, { htmlGenerationId: (htmlGen as any)._id });
            }

            sharedHtmlGenerations.push({
              ...htmlGen,
              sharedVia: {
                organization: resource.organization,
                role: resource.role,
                ownerEmail: ownerDisplayName,
              },
            });
          }
        } catch (err) {
          log.error(`${LOG_PREFIX}GET HtmlGeneration shared tenant fetch failed`, { err, orgTenantId });
        }
      }

      // Merge and dedupe by page_id to avoid duplicates between own and shared lists.
      const combined = [...htmlGenerations, ...sharedHtmlGenerations];
      const combinedById = new Map<string, any>();
      combined.forEach(item => {
        const key = (item as any)?._id;
        if (key && !combinedById.has(key)) {
          combinedById.set(key, item);
        }
      });
      allHtmlGenerations = Array.from(combinedById.values());
      log.info(`${LOG_PREFIX}GET HtmlGeneration merged results`, { total: allHtmlGenerations.length, ownCount: htmlGenerations.length, sharedCount: sharedHtmlGenerations.length });
    } catch (sharedError) {
      log.error(`${LOG_PREFIX}GET HtmlGeneration shared fetch error`, { err: sharedError });
      // Continue with just the user's own HTML generations
    }

    return NextResponse.json({
      success: true,
      data: allHtmlGenerations.map((item: any) => ({
        ...item,
        aiProvider: item?.metadata?.aiProvider || 'unknown'
      })),
      total: allHtmlGenerations.length
    });

  } catch (error) {
    log.error(`${LOG_PREFIX}GET /api/get-html-content error`, { err: error });
    const message = (error instanceof Error && /unauthorized/i.test(error.message)) ? 'Unauthorized' : 'Failed to fetch HTML generation';
    const status = /unauthorized/i.test((error as any)?.message) ? 401 : 500;
    return NextResponse.json(
      {
        success: false,
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status }
    );
  }
}

// #lizard forgives
export async function POST_impl(request: NextRequest): Promise<NextResponse> {
  log.info(`${LOG_PREFIX}POST_impl: start async HTML generation request`);
  try {
    log.info(`${LOG_PREFIX}POST_impl: getting session`);
    const session = await getSessionSafely(request, interfaceAuthOptions);
    const sessionUser = session?.user ?? null;
    const sessionId = ((session as any)?.sessionId as string | null) || ((sessionUser as any)?.sessionId as string | null) || null;
    const sessionUserName = ((sessionUser as any)?.name as string | null) || null;
    setLogContext({ sessionId, userId: sessionUser?.id ?? null, userName: sessionUserName });
    if (!session || !session.user) {
      log.warn(`${LOG_PREFIX}POST_impl: unauthorized - no session or user`);
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    log.info(`${LOG_PREFIX}POST_impl: parsing request body`);
    const body: CreateHtmlGenerationRequest = await request.json();

    // CRITICAL: tenantId must come from the assistant, NOT the user
    if (!body.assistantName) {
      log.warn('POST_impl: missing assistantName');
      return NextResponse.json({ success: false, message: 'assistantName is required' }, { status: 400 });
    }
    
    let assistant = await getAssistantByName(body.assistantName);
    if (!assistant) {
      try {
        assistant = await AssistantActions.getAssistantBySubDomain(body.assistantName);
      } catch (_) {
        // no-op
      }
    }
    if (!assistant?.tenantId) {
      log.warn('POST_impl: assistant not found or has no tenantId', { assistantName: body.assistantName });
      return NextResponse.json({ success: false, message: 'Assistant not found or has no tenantId' }, { status: 404 });
    }
    const tenantId = assistant.tenantId;
    log.info('POST_impl: session valid', { tenantId, userId, assistantName: body.assistantName });

    // Default to openai gpt-5 if not specified
    const finalProvider = body.aiProvider || 'openai';
    const finalModel = body.aiModel || 'gpt-5';

    log.info(`${LOG_PREFIX}POST_impl: creating async HTML generation`, {
      contentType: body.contentType,
      title: body.title,
      description: body.description,
      userRequest: body.userRequest,
      aiProvider: finalProvider,
      aiModel: finalModel,
      hasFeatures: !!(body.features && body.features.length > 0),
      hasSourceNoteId: !!body.sourceNoteId
    });

    // Generate unique job ID for tracking
    const jobId = `html-gen-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    log.info(`${LOG_PREFIX}POST_impl: generated job id`, { jobId });

    // Initialize status tracking
    const title = body.title || 'Untitled';
    await setGenerationStarted(jobId, title, tenantId, userId);

    // Add jobId to metadata for recovery and ensure provider/model are set
    const requestWithJobId: CreateHtmlGenerationRequest = {
      ...body,
      aiProvider: finalProvider,
      aiModel: finalModel,
      metadata: {
        ...body.metadata,
        jobId
      }
    };

    // Start async generation (don't await)
    generateHtmlAsync(jobId, requestWithJobId, tenantId, (session.user as any)?.name || (session.user as any)?.email || 'Unknown', userId).catch(async error => {
      log.error(`${LOG_PREFIX}Async generation failed`, { err: error, jobId, stack: error instanceof Error ? error.stack : undefined });
      await setGenerationFailed(jobId, error instanceof Error ? error.message : 'Unknown error', tenantId, userId);
    });

    log.info(`${LOG_PREFIX}POST_impl: returning job id`, { jobId });
    return NextResponse.json({
      success: true,
      message: `Starting generation of ${body.title}...`,
      data: {
        jobId,
        title: body.title,
        contentType: body.contentType,
        status: 'processing'
      }
    });

  } catch (error) {
    log.error(`${LOG_PREFIX}POST_impl: error starting HTML generation`, { err: error, stack: error instanceof Error ? error.stack : undefined });
    const message = (error instanceof Error && /unauthorized/i.test(error.message)) ? 'Unauthorized' : 'Failed to start HTML generation';
    const status = /unauthorized/i.test((error as any)?.message) ? 401 : 500;

    log.info(`${LOG_PREFIX}POST_impl: returning error response`, { status });
    return NextResponse.json(
      {
        success: false,
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status }
    );
  }
}
