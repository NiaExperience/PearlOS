import { NextRequest, NextResponse } from 'next/server';
import { ToolsActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { toolId } = await req.json();
    if (!toolId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const deleted = await ToolsActions.deleteTool(toolId, userId, dashboardAuthOptions);
    if (deleted) {
      return NextResponse.json({ success: true, tool: deleted });
    } else {
      return NextResponse.json({ error: 'Failed to delete tool' }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Delete failed' }, { status: 500 });
  }
} 