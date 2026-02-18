import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';

import { deleteDevRoom, getDevRoomUrl } from '../lib/config';

function resolveSearchParam(url: string, key: string): string | undefined {
  const value = new URL(url).searchParams.get(key);
  return value ? value.trim() : undefined;
}

export async function GET_impl(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(request, interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const roomUrl = await getDevRoomUrl();
  if (!roomUrl) {
    return NextResponse.json({ error: 'failed to create room' }, { status: 500 });
  }

  return NextResponse.json({ roomUrl });
}

export async function DELETE_impl(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(request, interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ deleted: false, error: 'unauthorized' }, { status: 401 });
  }

  const roomUrl = resolveSearchParam(request.url, 'roomUrl');
  const roomName = resolveSearchParam(request.url, 'roomName');

  const deleted = await deleteDevRoom({ roomUrl, roomName });

  return NextResponse.json({ deleted });
}
