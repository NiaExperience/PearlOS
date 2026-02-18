import { NextRequest, NextResponse } from 'next/server';
import { AssistantActions } from '@nia/prism/core/actions';

// POST /api/assistant/delete
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { assistantId } = await req.json();
    if (!assistantId) {
      return NextResponse.json({ error: 'assistantId is required' }, { status: 400 });
    }
    const deleted = await AssistantActions.deleteAssistant(assistantId);
    if (deleted) {
      return NextResponse.json({ success: true, assistant: deleted });
    }
    return NextResponse.json({ error: 'Failed to delete assistant' }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Delete failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
