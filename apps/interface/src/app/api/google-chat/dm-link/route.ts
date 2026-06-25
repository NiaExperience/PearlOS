import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import {
  googleChatAppMetadata,
  googleChatIsConfigured,
  googleChatMissingConfigReasons,
  getGoogleChatLinkStatusForUser,
  requireGoogleChatPearlOsIdentity,
  revokeGoogleChatLink,
} from '../_lib/google-chat-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const appMetadata = googleChatAppMetadata();
  const configured = googleChatIsConfigured();
  if (!configured) {
    return NextResponse.json({
      enabled: false,
      linked: false,
      pending: false,
      reasons: googleChatMissingConfigReasons(),
      ...appMetadata,
      oauthConfigured: false,
    });
  }

  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ linked: false, reason: 'unauthorized' }, { status: 401 });
  }

  let identity;
  try {
    identity = await requireGoogleChatPearlOsIdentity(session.user.id);
  } catch (error) {
    return NextResponse.json({
      enabled: true,
      linked: false,
      pending: false,
      reason: error instanceof Error ? error.message : 'google_account_required',
      ...appMetadata,
      oauthConfigured: Boolean(
        process.env.GOOGLE_CHAT_OAUTH_CLIENT_ID || process.env.GOOGLE_INTERFACE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
      ),
    }, { status: 403 });
  }

  const status = await getGoogleChatLinkStatusForUser(session.user.id);
  return NextResponse.json({
    enabled: true,
    ...status,
    pearlOsGoogleEmail: identity.email,
    ...appMetadata,
    oauthConfigured: Boolean(
      process.env.GOOGLE_CHAT_OAUTH_CLIENT_ID || process.env.GOOGLE_INTERFACE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    ),
  });
}

export async function DELETE(_req: NextRequest) {
  if (!googleChatIsConfigured()) {
    return NextResponse.json({ success: false, reason: 'google_chat_disabled' }, { status: 404 });
  }

  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  const revoked = await revokeGoogleChatLink(session.user.id);
  return NextResponse.json({ success: true, revoked });
}
