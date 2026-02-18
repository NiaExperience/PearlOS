// DailyCall event adapter (NO-OP placeholder)
// Intentionally minimal to avoid divergence before merging staging-pipecat-events.
// Replace implementations with real bus publish calls after unified JS event bus lands.

export interface DailyJoinPayload {
  userId?: string;
  username?: string;
  roomUrl: string;
  ts: number;
}

export interface DailyLeavePayload extends DailyJoinPayload {
  reason?: string;
}

export interface DailyParticipantUpdatePayload {
  participantId: string;
  username?: string;
  joined: boolean;
  tracks: { audio: boolean; video: boolean };
  local: boolean;
  ts: number;
}

export interface DailyErrorPayload {
  code?: string | number;
  message: string;
  fatal?: boolean;
  ts: number;
}

export interface DailyStatePayload {
  roomUrl: string;
  participantCount: number;
  activeSpeakerId?: string;
  ts: number;
}

// Publish API (currently just client logger debug)
import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('[daily_call]');

function debug(topic: string, payload: any) {
  if (process.env.NEXT_PUBLIC_DEBUG_DAILYCALL_EVENTS === '1') {
    log.debug(`[dailycall-event][noop] ${topic}`, {
      event: 'daily_event_noop',
      topic,
      payload,
    });
  }
}

export function publishDailyJoin(p: DailyJoinPayload) {
  debug('daily.join', p);
}
export function publishDailyLeave(p: DailyLeavePayload) {
  debug('daily.leave', p);
}
export function publishDailyParticipantUpdate(p: DailyParticipantUpdatePayload) {
  debug('daily.participant.update', p);
}
export function publishDailyError(p: DailyErrorPayload) {
  debug('daily.error', p);
}
export function publishDailyState(p: DailyStatePayload) {
  debug('daily.state', p);
}

// TODO(after merge with staging-pipecat-events): wire these to real bus
