import { NextRequest, NextResponse } from 'next/server';
import { getDiscordDmLinkByDiscordId } from '@nia/prism/core/actions/discord-dm-link-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import { composeUserPrompt } from '@interface/app/api/userProfile/prompt/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const provided =
    req.headers.get('x-internal-secret')?.trim() ||
    req.headers.get('x-discord-dm-link-secret')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  const expected = (process.env.DISCORD_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || '').trim();
  return Boolean(expected && provided && provided === expected);
}

function compactPrompt(input: string): string {
  return input
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ linked: false, reason: 'forbidden' }, { status: 403 });
  }

  const discordUserId = req.nextUrl.searchParams.get('discordUserId')?.trim() || '';
  if (!/^\d{17,20}$/.test(discordUserId)) {
    return NextResponse.json({ linked: false, reason: 'invalid_discord_user_id' }, { status: 400 });
  }

  const link = await getDiscordDmLinkByDiscordId(discordUserId);
  if (!link?.userId) {
    return NextResponse.json({ linked: false, reason: 'not_linked' });
  }

  const user = await getUserById(link.userId);
  if (!user?._id) {
    return NextResponse.json({ linked: false, reason: 'user_not_found' });
  }

  const userPrompt = await composeUserPrompt(
    {
      id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified ?? null,
    },
    'Pearl',
  );

  return NextResponse.json({
    linked: true,
    userId: user._id,
    userName: user.name,
    userEmail: user.email ?? null,
    discordUserId: link.discordUserId,
    verifiedAt: link.verifiedAt,
    context: compactPrompt(userPrompt),
  });
}
