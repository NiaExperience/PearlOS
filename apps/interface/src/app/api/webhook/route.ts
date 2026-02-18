export const dynamic = "force-dynamic";
import { interfaceAuthOptions } from "@interface/lib/auth-config";
import { getSessionSafely, requireAuth } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_webhook]');

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    log.info('POST /api/webhook request received');

    // Check access FIRST - before any processing
    const authError = await requireAuth(req, interfaceAuthOptions);
    if (authError) {
      log.warn('Access denied');
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check session  
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!session || !session.user) {
      log.warn('Unauthorized - no valid session');
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.is_anonymous) {
      log.info('Anonymous access OK');
    }

    const data = await req.json();

    if (data.message.type === 'end-of-call-report') {
      // TODO: save it (where?) or chuck it?
      return NextResponse.json({
        result: 'Message saved',
      });
    }

    log.info('Webhook handled');
    return NextResponse.json({
      msg: 'Done ✅',
    });
  } catch (error) {
    log.error('Error processing POST request', { error });
    return NextResponse.json(
      { error: 'Internal Server Error' },
      {
        status: 500,
      }
    );
  }
}
