import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { getAllAssistants } from '@nia/prism/core/actions/assistant-actions';
import { getTenantsForUser } from '@nia/prism/core/actions/tenant-actions';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const disableAuth =
    process.env.DISABLE_DASHBOARD_AUTH === 'true' &&
    (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1');

  const session = disableAuth ? null : await getSessionSafely(req, dashboardAuthOptions);
  if (!disableAuth) {
    if (!session || !session.user || session.user.is_anonymous) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  let tenantId = url.searchParams.get('tenantId');
  
  // For local dev mode without specific tenant, fetch all assistants
  const fetchAll = disableAuth && !tenantId;

  // In no-auth local mode, skip tenant membership checks
  if (!disableAuth) {
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }
    const userId = session!.user.id;
    // Validate user has access to the tenant
    const tenants = await getTenantsForUser(userId);
    if (!tenants.some(t => t._id === tenantId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Get assistants for authenticated user
    const assistants = (await getAllAssistants(tenantId, userId)) || [];
    const filtered = assistants.filter(a => a.tenantId === tenantId);
    return NextResponse.json({ assistants: filtered });
  }

  // Local dev mode: get all assistants without user filtering
  const { Prism } = await import('@nia/prism');
  const { BlockType_Assistant } = await import('@nia/prism/core/blocks/assistant.block');
  const prism = await Prism.getInstance();
  
  // Query without parent_id filter since assistants have tenantId in content, not parent_id
  const result = await prism.query({
    contentType: BlockType_Assistant,
    // Prism query expects a string. In local "fetchAll" mode we use the sentinel 'any'.
    // Otherwise tenantId must be provided.
    tenantId: fetchAll ? 'any' : (tenantId ?? ''),
    limit: 500,
    orderBy: { createdAt: 'desc' }
  });
  
  const assistants = result?.items?.map((item: any) => {
    // Prism's applyBusinessLogic already flattens content to the item
    return {
      _id: item._id || item.page_id,
      name: item.name,
      subDomain: item.subDomain,
      tenantId: item.tenantId,
      firstMessage: item.firstMessage,
      ...item
    };
  }) || [];
  
  // Filter by tenantId if specified
  const filtered = fetchAll ? assistants : assistants.filter(a => a.tenantId === tenantId);
  return NextResponse.json({ assistants: filtered });
}
