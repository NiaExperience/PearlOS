import { EventEnum } from '@nia/events';

import { forwardAppEvent } from './appMessageBridge';

interface ParticipantState {
  id: string;
  username?: string;
  local: boolean;
  joined: boolean;
  stealth?: boolean;
}

interface ParticipantsSnapshot {
  roomUrl: string;
  count: number;
  participants: Array<Omit<ParticipantState, 'joined'>>;
  ts: number;
}

const participants = new Map<string, ParticipantState>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let firstJoinEmitted = false;
let lastRoomUrl: string | undefined;

const DEBOUNCE_MS = 150; // aggregate rapid churn

export function recordParticipantJoin(roomUrl: string, id: string, username: string | undefined, local: boolean, stealth?: boolean) {
  lastRoomUrl = roomUrl;
  participants.set(id, { id, username, local, joined: true, stealth: !!stealth });
  if (!local && !firstJoinEmitted && !stealth) {
    firstJoinEmitted = true;
    forwardAppEvent(EventEnum.DAILY_PARTICIPANT_FIRST_JOIN, { roomUrl, participantId: id, username });
  }
  scheduleFlush(roomUrl);
}

export function recordParticipantLeave(roomUrl: string, id: string) {
  lastRoomUrl = roomUrl;
  participants.delete(id);
  scheduleFlush(roomUrl);
}

function scheduleFlush(roomUrl: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => flush(roomUrl), DEBOUNCE_MS);
}

function flush(roomUrl: string) {
  const snap = internalSnapshot(roomUrl);
  forwardAppEvent(EventEnum.DAILY_PARTICIPANTS_CHANGE, snap);
}

function internalSnapshot(roomUrl: string): ParticipantsSnapshot {
  const arr = Array.from(participants.values())
    .filter(p => p.joined && !p.stealth)
    .map(p => ({ id: p.id, username: p.username, local: p.local }));
  return { roomUrl, count: arr.length, participants: arr, ts: Date.now() };
}

export function getParticipantsSnapshot(): ParticipantsSnapshot | null {
  if (!lastRoomUrl) return null;
  return internalSnapshot(lastRoomUrl);
}

// Testing & reset
export function __resetParticipantsAggregator() {
  participants.clear();
  firstJoinEmitted = false;
  lastRoomUrl = undefined;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}
