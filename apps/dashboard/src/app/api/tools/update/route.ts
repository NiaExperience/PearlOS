import { NextRequest, NextResponse } from 'next/server';
import { AssistantActions, ToolsActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

// POST /api/tools/update
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { toolId, ...updateFields } = await req.json();
    if (!toolId) {
      return NextResponse.json({ error: 'toolId is required' }, { status: 400 });
    }
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let tenantId = req.nextUrl.searchParams.get('tenantId') as string;
    if (!tenantId) {
      const assistantName = req.nextUrl.searchParams.get('agent') as string;
      if (assistantName) {
        const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
        if (assistant) {
          tenantId = assistant.tenantId;
        } else {
          return NextResponse.json({ error: `Agent ${assistantName} not found` }, { status: 404 });
        }
      } else {
        return NextResponse.json({ error: 'Agent or tenantId is required' }, { status: 400 });
      }
    }

    const updated = await ToolsActions.updateTool(toolId, tenantId, updateFields, dashboardAuthOptions);
    if (updated) {
      return NextResponse.json({ success: true, tool: updated });
    }
    return NextResponse.json({ error: 'Failed to update tool' }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Update failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
