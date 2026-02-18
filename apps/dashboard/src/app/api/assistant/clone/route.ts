import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { AssistantActions } from '@nia/prism/core/actions';

// Check if we should bypass auth for local development
function shouldBypassAuth(req: NextRequest): boolean {
	const disableAuth = process.env.DISABLE_DASHBOARD_AUTH === 'true' ||
		(process.env.NODE_ENV === 'development' &&
			(req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1'));
	return disableAuth;
}

// POST /api/assistant/clone
export async function POST(req: NextRequest) {
  try {
    // Bypass auth for local development
    if (shouldBypassAuth(req)) {
      const { assistantId, templateId, newName, persona_name, newSubdomain, special_instructions } = await req.json();
      const sourceId = assistantId || templateId; // allow either parameter for cloning
      if (!sourceId || !newName) {
        return NextResponse.json({ error: 'assistantId/templateId and newName are required' }, { status: 400 });
      }
      const cloneParams = { newName, persona_name, newSubdomain, special_instructions };
      const newAssistant = await AssistantActions.cloneAssistant(sourceId, cloneParams);
      if (newAssistant) {
        console.log(`[assistant] Local dev: Cloned assistant ${newAssistant._id}`);
        return NextResponse.json({ success: true, assistant: newAssistant });
      }
      return NextResponse.json({ error: 'Failed to clone assistant' }, { status: 500 });
    }
    
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { assistantId, templateId, newName, persona_name, newSubdomain, special_instructions } = await req.json();
    const sourceId = assistantId || templateId; // allow either parameter for cloning
    if (!sourceId || !newName) {
      return NextResponse.json({ error: 'assistantId/templateId and newName are required' }, { status: 400 });
    }
    const cloneParams = { newName, persona_name, newSubdomain, special_instructions };
    const newAssistant = await AssistantActions.cloneAssistant(sourceId, cloneParams);
    if (newAssistant) {
      return NextResponse.json({ success: true, assistant: newAssistant });
    }
    return NextResponse.json({ error: 'Failed to clone assistant' }, { status: 500 });
  } catch (error) {
    console.error('Failed to clone assistant:', error);
    return NextResponse.json({ error: 'Clone failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';