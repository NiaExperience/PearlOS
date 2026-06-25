import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { addForumReply, addForumTopic, readForumTopics } from '@interface/lib/our-pearlos-forum-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SessionLike = Awaited<ReturnType<typeof getSessionSafely>>;

function cleanNamePart(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[^\p{L}\p{N}'-]+/gu, ' ').trim()
    : '';
}

function nameTokens(value: unknown): string[] {
  return cleanNamePart(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function emailTokens(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const local = value.split('@')[0] || '';
  return local
    .split(/[._+-]+/)
    .map(cleanNamePart)
    .filter((token) => token.length > 1);
}

function publicAuthorLabel(input: {
  profileFirstName?: unknown;
  personaName?: unknown;
  sessionName?: unknown;
  email?: unknown;
}): string {
  const fullNameTokens = [
    nameTokens(input.personaName),
    nameTokens(input.sessionName),
    emailTokens(input.email),
  ].find((tokens) => tokens.length > 0) ?? [];
  const first = cleanNamePart(input.profileFirstName) || fullNameTokens[0] || 'PearlOS User';
  const lastToken = fullNameTokens.find((token) => token.toLowerCase() !== first.toLowerCase() && token.length > 0);
  const lastInitial = lastToken?.[0]?.toUpperCase();
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

async function forumIdentity(req: NextRequest): Promise<{ signedIn: boolean; authorLabel: string }> {
  const session = await getSessionSafely(req, interfaceAuthOptions).catch(() => null) as SessionLike | null;
  const user = session?.user;
  const userId = user?.id;
  const email = (user as { email?: string } | undefined)?.email || undefined;
  if (!userId && !email) return { signedIn: false, authorLabel: '' };

  const found = await UserProfileActions.findByUser(userId || undefined, email).catch(() => null);
  const profile = found?.userProfile || null;
  return {
    signedIn: true,
    authorLabel: publicAuthorLabel({
      profileFirstName: profile?.first_name,
      personaName: profile?.publicPersona?.displayName,
      sessionName: (user as { name?: string } | undefined)?.name,
      email,
    }),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const identity = await forumIdentity(req);
  const topics = await readForumTopics();
  return NextResponse.json(
    {
      ok: true,
      signedIn: identity.signedIn,
      viewerLabel: identity.authorLabel || null,
      topics,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const identity = await forumIdentity(req);
  if (!identity.signedIn) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'topic') {
    const topic = await addForumTopic({
      title: body.title,
      body: body.body,
      authorLabel: identity.authorLabel,
    });
    if (!topic) return NextResponse.json({ error: 'invalid_topic' }, { status: 400 });
    return NextResponse.json({ ok: true, topic });
  }

  if (action === 'reply') {
    const topic = await addForumReply({
      topicId: body.topicId,
      body: body.body,
      authorLabel: identity.authorLabel,
    });
    if (!topic) return NextResponse.json({ error: 'invalid_reply' }, { status: 400 });
    return NextResponse.json({ ok: true, topic });
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}
