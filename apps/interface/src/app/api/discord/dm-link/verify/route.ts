import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { hashDiscordCode } from '@interface/lib/discord-dm-code';
import { sendDiscordDm } from '../../_lib/send-discord-dm';
import {
  getActiveDiscordDmVerification,
  incrementDiscordDmVerificationAttempt,
  markDiscordDmVerificationConsumed,
} from '@nia/prism/core/actions/discord-dm-verification-actions';
import { upsertDiscordDmLink } from '@nia/prism/core/actions/discord-dm-link-actions';
import { approveDiscordOpenClawAccess } from '../_lib/openclaw-discord-access';

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

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter a valid 6-character code.' }, { status: 400 });
  }

  const verification = await getActiveDiscordDmVerification(session.user.id);
  if (!verification || !verification._id) {
    return NextResponse.json({ error: 'No active code found or code expired.' }, { status: 410 });
  }

  if (new Date(verification.expiresAt).getTime() <= Date.now()) {
    await markDiscordDmVerificationConsumed(verification._id);
    return NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 410 });
  }

  if (!verification.discordUserId) {
    return NextResponse.json(
      { error: 'Send this code to Pearl in Discord, then check the connection here.' },
      { status: 409 },
    );
  }

  const providedHash = hashDiscordCode(code);
  if (providedHash !== verification.codeHash) {
    const updated = await incrementDiscordDmVerificationAttempt(verification._id);
    if ((updated?.attempts ?? 0) >= 5) {
      return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429 });
    }
    return NextResponse.json({ error: 'Incorrect code. Try again.' }, { status: 400 });
  }

  await markDiscordDmVerificationConsumed(verification._id);
  const link = await upsertDiscordDmLink({
    userId: session.user.id,
    discordUserId: verification.discordUserId,
  });
  const openclaw = await approveDiscordOpenClawAccess(link.discordUserId);
  try {
    await sendDiscordDm(
      link.discordUserId,
      `You're verified for Pearl DMs.\n\n` +
        `You can now talk to Pearl directly here, and mention @Pearl in Pearl Village.\n\n` +
        `If this wasn't you, remove the Discord link from PearlOS Settings.`,
    );
  } catch (err) {
    console.warn('[discord/dm-link/verify] verification confirmation DM failed', err);
  }

  return NextResponse.json({
    success: true,
    linked: true,
    discordUserId: link.discordUserId,
    verifiedAt: link.verifiedAt,
    openclaw,
  });
}
