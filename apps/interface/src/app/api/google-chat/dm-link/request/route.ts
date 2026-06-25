import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import {
  googleChatAppMetadata,
  googleChatIsConfigured,
  requestGoogleChatLinkCode,
} from '../../_lib/google-chat-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  if (!googleChatIsConfigured()) {
    return NextResponse.json({ success: false, reason: 'google_chat_disabled' }, { status: 404 });
  }

  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await requestGoogleChatLinkCode(session.user.id);
    return NextResponse.json({
      success: true,
      code: result.code,
      expiresAt: result.expiresAt,
      pearlOsGoogleEmail: result.pearlOsGoogleEmail,
      ...googleChatAppMetadata(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'google_chat_code_failed';
    const status = reason === 'google_account_required' || reason === 'google_chat_public_tenant_required' ? 403 : 500;
    return NextResponse.json({ success: false, reason }, { status });
  }
}
