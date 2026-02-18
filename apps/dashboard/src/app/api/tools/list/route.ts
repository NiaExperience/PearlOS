import { NextRequest, NextResponse } from 'next/server';
import { ToolsActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tools = await ToolsActions.getAllTools(session.user.id);
    return NextResponse.json({ tools });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch tools' }, { status: 500 });
  }
} 