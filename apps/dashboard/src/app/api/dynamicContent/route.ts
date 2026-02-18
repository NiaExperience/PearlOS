import { NextRequest, NextResponse } from 'next/server';
import { GET_impl } from '@nia/prism/core/routes/content/definitions/route';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { Prism } from '@nia/prism';
import { AssistantActions } from '@nia/prism/core/actions';

// Check if we should bypass auth for local development
function shouldBypassAuth(req: NextRequest): boolean {
  const disableAuth = process.env.DISABLE_DASHBOARD_AUTH === 'true' &&
    (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1') &&
    process.env.NODE_ENV !== 'production';
  return disableAuth;
}

/**
 * API route to handle dynamic content definitions retrieval
 * GET /api/dynamicContent
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Bypass auth for local dev
  if (shouldBypassAuth(req)) {
    try {
      const searchParams = req.nextUrl.searchParams;
      let tenantId = searchParams.get('tenantId');
      const assistantId = searchParams.get('assistantId');
      const agent = searchParams.get('agent') || searchParams.get('subDomain');

      // Handle assistant-based tenant resolution
      if (!tenantId && (assistantId || agent)) {
        let assistant = null;
        if (assistantId) {
          assistant = await AssistantActions.getAssistantById(assistantId);
        } else if (agent) {
          assistant = await AssistantActions.getAssistantBySubDomain(agent);
        }

        if (!assistant) {
          return NextResponse.json({ error: 'Assistant not found' }, { status: 404 });
        }

        if (assistant && assistant.tenantId) {
          tenantId = assistant.tenantId;
        } else {
          return NextResponse.json({ error: 'Assistant has no tenant ID' }, { status: 400 });
        }
      }
      
      if (!tenantId) {
        // In local dev without tenantId, return empty list
        return NextResponse.json({ items: [] }, { status: 200 });
      }

      const prism = await Prism.getInstance();
      const result = await prism.listDefinitions(tenantId);
      return NextResponse.json({ items: result.items || [] }, { status: 200 });
    } catch (error: any) {
      console.error('[dynamicContent] Error:', error);
      return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
  }
  return GET_impl(req, dashboardAuthOptions);
}
