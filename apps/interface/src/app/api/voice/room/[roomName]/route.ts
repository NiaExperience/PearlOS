/**
 * Voice Room Deletion API
 * DELETE /api/voice/room/[roomName] - Delete a voice room
 * 
 * Handles cleanup of Daily.co rooms when sessions end
 */

import { NextRequest, NextResponse } from "next/server";

import { getVoiceRoomName } from "../route";
import { resolveInterfaceActorContext } from "@interface/lib/tenant-actor";

export const dynamic = "force-dynamic";

// Daily.co API configuration
const DAILY_API_URL = process.env.DAILY_API_URL || 'https://api.daily.co/v1';
const DAILY_API_KEY = process.env.DAILY_API_KEY;

interface RouteContext {
  params: {
    roomName: string;
  };
}

/**
 * Delete a Daily room
 */
async function deleteDailyRoom(roomName: string): Promise<void> {
  if (!DAILY_API_KEY) {
    throw new Error('Daily API key not configured');
  }

  const response = await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to delete Daily room: ${response.status} ${JSON.stringify(error)}`);
  }
}

/**
 * DELETE /api/voice/room/[roomName]
 * Delete a voice room
 */
export async function DELETE(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { roomName } = context.params;

    if (!roomName) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }

    const url = new URL(req.url);
    const requestedTenantId =
      url.searchParams.get('tenantId') ||
      url.searchParams.get('tenant_id') ||
      req.headers.get('x-tenant-id') ||
      undefined;
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId,
    });
    if (!actorResult.ok) return actorResult.response;

    const actor = actorResult.actor;
    const expectedRoomName = getVoiceRoomName(actor.tenantId, actor.userId);
    if (roomName !== expectedRoomName) {
      return NextResponse.json(
        { error: 'Cannot delete room belonging to another user' },
        { status: 403 }
      );
    }

    // Delete the room
    await deleteDailyRoom(roomName);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to delete voice room', details: message },
      { status: 500 }
    );
  }
}
