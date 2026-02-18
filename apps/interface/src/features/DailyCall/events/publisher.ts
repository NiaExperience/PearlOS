// DailyCall event publisher wrappers (incremental step)
// Wrap adapter publish functions to keep components lean and allow unit testing.
// Updated: wire event "type" fields to code‑generated EventEnum constants from @nia/events
// instead of duplicating raw string literals, ensuring canonical event naming.

import { publishDailyJoin, publishDailyLeave, DailyJoinPayload, DailyLeavePayload, publishDailyParticipantUpdate, publishDailyError, publishDailyState } from './adapter';
import { EventEnum } from '@nia/events';
import { forwardAppEvent } from './appMessageBridge';

export type NowFn = () => number;

export function emitLocalJoin(username: string, roomUrl: string, now: NowFn = Date.now) {
  const payload: DailyJoinPayload = { username, roomUrl, ts: now() };
  publishDailyJoin(payload);
  return payload; // return for convenience / potential chaining in callers or tests
}

export function emitLocalLeave(roomUrl: string, username: string | undefined, reason: string | undefined, now: NowFn = Date.now) {
  const payload: DailyLeavePayload = { username, roomUrl, ts: now(), reason };
  publishDailyLeave(payload);
  return payload;
}

// --- Additional incremental emission wrappers (still using join/leave publish fns as placeholders) ---

export interface ParticipantJoinPayload {
  type: EventEnum.DAILY_PARTICIPANT_JOIN;
  roomUrl: string;
  participantId: string;
  username?: string;
  ts: number;
}

export interface ParticipantLeavePayload {
  type: EventEnum.DAILY_PARTICIPANT_LEAVE;
  roomUrl: string;
  participantId: string;
  username?: string;
  reason?: string;
  ts: number;
}

export type CallStatePhase = 'joining' | 'joined' | 'leaving' | 'left';
export interface CallStatePayload {
  type: EventEnum.DAILY_CALL_STATE;
  roomUrl: string;
  phase: CallStatePhase;
  username?: string;
  participantCount?: number;
  ts: number;
}

export interface CallErrorPayload {
  type: EventEnum.DAILY_CALL_ERROR;
  roomUrl: string;
  message: string;
  code?: string;
  username?: string;
  ts: number;
}

export interface ParticipantUpdatePayload {
  roomUrl: string;
  participantId: string;
  username?: string;
  joined: boolean;
  local: boolean;
  tracks: { audio: boolean; video: boolean };
  reason?: string;
  ts: number;
}

export function emitParticipantJoin(roomUrl: string, participantId: string, username?: string, now: NowFn = Date.now) {
  const payload: ParticipantJoinPayload = { type: EventEnum.DAILY_PARTICIPANT_JOIN, roomUrl, participantId, username, ts: now() };
  publishDailyJoin(payload as any);
  forwardAppEvent(EventEnum.DAILY_PARTICIPANT_JOIN, payload);
  return payload;
}

export function emitParticipantLeave(roomUrl: string, participantId: string, username?: string, reason?: string, now: NowFn = Date.now) {
  const payload: ParticipantLeavePayload = { type: EventEnum.DAILY_PARTICIPANT_LEAVE, roomUrl, participantId, username, reason, ts: now() };
  publishDailyLeave(payload as any);
  forwardAppEvent(EventEnum.DAILY_PARTICIPANT_LEAVE, payload);
  return payload;
}

export function emitCallStateChange(roomUrl: string, phase: CallStatePhase, username?: string, participantCount?: number, now: NowFn = Date.now) {
  const payload: CallStatePayload = { type: EventEnum.DAILY_CALL_STATE, roomUrl, phase, username, participantCount, ts: now() };
  // still using join channel placeholder until real bus topics wired
  publishDailyJoin(payload as any);
  if (typeof participantCount === 'number') {
    publishDailyState({ roomUrl, participantCount, ts: payload.ts });
  }
  forwardAppEvent(EventEnum.DAILY_CALL_STATE, payload);
  return payload;
}

export function emitCallError(roomUrl: string, message: string, code?: string, username?: string, now: NowFn = Date.now) {
  const payload: CallErrorPayload = { type: EventEnum.DAILY_CALL_ERROR, roomUrl, message, code, username, ts: now() };
  publishDailyLeave(payload as any);
  publishDailyError({ message, code, ts: payload.ts });
  forwardAppEvent(EventEnum.DAILY_CALL_ERROR, payload);
  return payload;
}

export function emitParticipantUpdate(p: Omit<ParticipantUpdatePayload, 'ts'>, now: NowFn = Date.now) {
  const payload: ParticipantUpdatePayload = { ...p, ts: now() };
  publishDailyParticipantUpdate(payload);
  return payload;
}
