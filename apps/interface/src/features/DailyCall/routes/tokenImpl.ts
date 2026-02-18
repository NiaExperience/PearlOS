import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { STEALTH_USER_ID } from '@nia/features';

import { DAILY_API_KEY, DAILY_API_URL, getRoomNameFromUrl } from '../lib/config';

interface TokenPayload {
  roomUrl?: string;
  roomName?: string;
  expiresInSeconds?: number;
  stealth?: boolean;
  displayName?: string;
}

interface DailyTokenResponse {
  token?: string;
}

function resolveExpiration(expiresInSeconds?: number): number {
  const fallbackSeconds = 60 * 60; // 1 hour default
  const seconds = Number.isFinite(expiresInSeconds) ? Number(expiresInSeconds) : fallbackSeconds;
  const safeSeconds = seconds > 0 ? seconds : fallbackSeconds;
  const currentEpoch = Math.floor(Date.now() / 1000);
  return currentEpoch + safeSeconds;
}

export async function POST_impl(request: NextRequest): Promise<NextResponse> {
  if (!DAILY_API_KEY) {
    return NextResponse.json({ error: 'daily_api_key_missing' }, { status: 500 });
  }

  const session = await getSessionSafely(request, interfaceAuthOptions);
  const body = (await request.json().catch(() => ({}))) as TokenPayload;
  const isStealth = body.stealth === true;
  const roomName = body.roomName || getRoomNameFromUrl(body.roomUrl ?? '');
  const requestedDisplayName = body.displayName?.trim();
  
  // Support both authenticated and anonymous users
  const sessionUser = session?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  const hasSession = !!session?.user?.id;
  
  // Determine user name: prefer requested displayName, then session name/email, fallback to 'Guest'
  const tokenUserName = isStealth
    ? 'Guest'
    : requestedDisplayName || sessionUser?.name || sessionUser?.email || 'Guest';
  
  // Use a dedicated stealth sentinel only for stealth joins.
  // Anonymous non-stealth users must not look like stealth participants.
  const tokenUserId = isStealth
    ? STEALTH_USER_ID
    : (sessionUser?.id || `anon-daily-${roomName}-${Math.random().toString(36).slice(2, 10)}`);

  if (!roomName) {
    return NextResponse.json({ error: 'room_name_required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          user_id: tokenUserId,
          user_name: tokenUserName,
          is_owner: true,
          exp: resolveExpiration(body.expiresInSeconds),
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return NextResponse.json(
        { error: 'token_generation_failed', detail },
        { status: response.status || 502 },
      );
    }

    const data = (await response.json().catch(() => ({}))) as DailyTokenResponse;
    if (!data?.token) {
      return NextResponse.json({ error: 'token_missing' }, { status: 502 });
    }

    return NextResponse.json({ token: data.token });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'token_generation_exception', detail: message }, { status: 500 });
  }
}
