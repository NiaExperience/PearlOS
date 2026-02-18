import { NextRequest, NextResponse } from 'next/server';
import { deleteTenant } from '@nia/prism/core/actions/tenant-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { isSuperAdmin } from '@nia/prism/core/auth/auth.middleware';
import { Prism, PrismContentQuery } from '@nia/prism';
import { BlockType_Assistant } from '@nia/prism/core/blocks/assistant.block';
import { BlockType_AssistantTheme } from '@nia/prism/core/blocks/assistantTheme.block';
import { BlockType_AssistantFeedback } from '@nia/prism/core/blocks/assistantFeedback.block';
import { BlockType_DynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';
import { BlockType_UserTenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { BlockType_UserOrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { BlockType_Organization } from '@nia/prism/core/blocks/organization.block';

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const { tenantId } = params;
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id || !isSuperAdmin(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden: Superadmin only' }, { status: 403 });
  }
  try {
    let purgeAll = false;
    try {
      const raw = await req.text();
      if (raw) {
        try { const body = JSON.parse(raw); purgeAll = !!body.purgeAll; } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    const result = await deleteTenant(tenantId);
    if (purgeAll) {
      try {
        const prism = await Prism.getInstance();
        const types = [
          BlockType_Assistant,
          BlockType_AssistantTheme,
          BlockType_AssistantFeedback,
          BlockType_DynamicContent,
          BlockType_UserTenantRole,
          BlockType_UserOrganizationRole,
          BlockType_Organization,
        ];
        for (const ct of types) {
          try {
            const q: PrismContentQuery = { contentType: ct, tenantId: 'any', where: { parent_id: tenantId }, orderBy: { createdAt: 'asc' } } as any;
            const res = await prism.query(q);
            for (const item of res.items || []) {
              try { await prism.delete(ct, (item as any)._id, 'any'); } catch { /* ignore individual */ }
            }
          } catch { /* ignore per-ct errors */ }
        }
      } catch { /* ignore purge errors */ }
    }
    return NextResponse.json({ ...result, purged: purgeAll });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to delete tenant' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
