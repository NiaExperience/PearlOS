import { NextRequest, NextResponse } from 'next/server';
import { ToolsActions } from '@nia/prism/core/actions';
import { ToolBlock } from '@nia/prism/core/blocks';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { name, description } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'Tool name is required' }, { status: 400 });
    }
    const tool = await ToolsActions.createTool({
      name,
      description: description || '',
      type: ToolBlock.ToolType.FUNCTION,
    }, dashboardAuthOptions);
    if (tool) {
      return NextResponse.json({ success: true, tool });
    } else {
      return NextResponse.json({ error: 'Failed to create tool' }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Tool creation failed' }, { status: 500 });
  }
} 