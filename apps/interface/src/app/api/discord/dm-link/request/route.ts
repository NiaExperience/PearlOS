import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import {
  DiscordDmVerificationRequestError,
  issueDiscordDmVerificationCode,
} from '../_lib/verification-request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await issueDiscordDmVerificationCode({
      userId: session.user.id,
      discordUserId: typeof body.discordUserId === 'string' ? body.discordUserId : '',
    });
    return NextResponse.json({
      success: true,
      code: result.code,
      expiresAt: result.expiresAt,
      codeSent: false,
      verificationMode: 'discord_code_message',
      instructions: `Send ${result.code} to Pearl in a Discord DM.`,
    });
  } catch (error) {
    if (error instanceof DiscordDmVerificationRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.warn('[discord/dm-link/request] verification request failed', error);
    return NextResponse.json({ error: 'Failed to create verification code' }, { status: 500 });
  }
}
