import { NextRequest, NextResponse } from 'next/server';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { GET_impl, POST_impl, PATCH_impl, DELETE_impl } from '@nia/prism/core/routes/tenants/route';
import { Prism } from '@nia/prism';
import { BlockType_Tenant } from '@nia/prism/core/blocks/tenant.block';

export const dynamic = 'force-dynamic';

// Check if we should bypass auth for local development
function shouldBypassAuth(req: NextRequest): boolean {
  const disableAuth = process.env.DISABLE_DASHBOARD_AUTH === 'true' &&
    (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1') &&
    process.env.NODE_ENV !== 'production';
  return disableAuth;
}

export async function GET(req: NextRequest) {
  // Bypass auth for local development
  if (shouldBypassAuth(req)) {
    try {
      const prism = await Prism.getInstance();
      const result = await prism.query({
        contentType: BlockType_Tenant,
        tenantId: 'any',
        limit: 500,
      });
      // Note: prism.query() applies business logic which flattens items to just content
      // So item IS the content, not a wrapper with item.content
      const tenants = (result?.items || []).map((item: any) => ({
        _id: item._id || item.page_id,
        name: item.name || 'Unknown Tenant',
        ...item,
      }));
      return NextResponse.json({ tenants });
    } catch (error) {
      console.error('[tenants] Local dev mode - failed to fetch tenants:', error);
      return NextResponse.json({ tenants: [] });
    }
  }
  return GET_impl(req, dashboardAuthOptions);
}

export async function POST(req: NextRequest) {
  // In local dev mode, allow creating tenants without auth
  if (shouldBypassAuth(req)) {
    try {
      const body = await req.json();
      if (!body.name) {
        return NextResponse.json({ error: 'Tenant name is required' }, { status: 400 });
      }
      const prism = await Prism.getInstance();
      const created = await prism.create(BlockType_Tenant, {
        name: body.name,
        domain: body.domain,
        description: body.description,
        settings: body.settings || {},
        planTier: body.planTier || 'professional',
      }, 'any');
      if (created && created.items && created.items.length > 0) {
        const item = created.items[0] as any;
        const content = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
        return NextResponse.json({
          tenant: { _id: item.page_id, ...content },
          ownerAssigned: false,
        }, { status: 201 });
      }
      return NextResponse.json({ error: 'Failed to create tenant' }, { status: 500 });
    } catch (error) {
      console.error('[tenants] Local dev mode - failed to create tenant:', error);
      return NextResponse.json({ error: 'Failed to create tenant' }, { status: 500 });
    }
  }
  return POST_impl(req, dashboardAuthOptions);
}

export async function PATCH(req: NextRequest) {
  return PATCH_impl(req, dashboardAuthOptions);
}

export async function DELETE(req: NextRequest) {
  return DELETE_impl(req, dashboardAuthOptions);
}
