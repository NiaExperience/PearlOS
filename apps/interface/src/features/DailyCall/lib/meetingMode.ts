/**
 * Meeting Mode — configures Pearl as a silent note-taker in group calls.
 *
 * When active:
 * - Pearl's audio output is suppressed (she doesn't speak unprompted)
 * - She continues listening via Deepgram STT (transcribes everything)
 * - She only speaks when explicitly addressed ("Pearl, ..." / "Hey Pearl")
 * - She maintains running meeting notes internally
 * - Notes can be shown on Wonder Canvas on demand
 */

import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('[meeting_mode]');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface MeetingModeState {
  active: boolean;
  startedAt: number | null;
  roomUrl: string | null;
}

let _state: MeetingModeState = {
  active: false,
  startedAt: null,
  roomUrl: null,
};

const listeners = new Set<(state: MeetingModeState) => void>();

export function getMeetingModeState(): Readonly<MeetingModeState> {
  return { ..._state };
}

export function onMeetingModeChange(cb: (state: MeetingModeState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function _notify() {
  const snapshot = getMeetingModeState();
  listeners.forEach((cb) => {
    try { cb(snapshot); } catch (_) { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Bot gateway helpers
// ---------------------------------------------------------------------------

const BOT_GATEWAY_BASE = process.env.NEXT_PUBLIC_BOT_GATEWAY_URL || 'http://localhost:7860';

async function _postMeeting(path: string, body?: Record<string, unknown>) {
  const url = `${BOT_GATEWAY_BASE}/api/meeting${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Meeting API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startMeetingMode(roomUrl: string): Promise<void> {
  if (_state.active) {
    log.warn('Meeting mode already active');
    return;
  }
  log.info('Starting meeting mode', { roomUrl });
  try {
    await _postMeeting('/start', { room_url: roomUrl });
  } catch (e) {
    log.error('Failed to start meeting mode on backend', { error: e });
    // Continue — frontend state still toggles so UI reflects intent
  }
  _state = { active: true, startedAt: Date.now(), roomUrl };
  window.dispatchEvent(new CustomEvent('meetingMode.changed', { detail: _state }));
  _notify();
}

export async function stopMeetingMode(): Promise<{ summary?: string } | null> {
  if (!_state.active) return null;
  log.info('Stopping meeting mode', { roomUrl: _state.roomUrl });
  let result: { summary?: string } | null = null;
  try {
    result = await _postMeeting('/stop', { room_url: _state.roomUrl });
  } catch (e) {
    log.error('Failed to stop meeting mode on backend', { error: e });
  }
  _state = { active: false, startedAt: null, roomUrl: null };
  window.dispatchEvent(new CustomEvent('meetingMode.changed', { detail: _state }));
  _notify();
  return result;
}

export async function fetchMeetingNotes(): Promise<{ notes: string; segments: unknown[] } | null> {
  try {
    const res = await fetch(`${BOT_GATEWAY_BASE}/api/meeting/notes`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function showMeetingNotes(roomUrl?: string): Promise<void> {
  await _postMeeting('/show', { room_url: roomUrl || _state.roomUrl });
}

// ---------------------------------------------------------------------------
// Wake-word detection (client-side heuristic)
// ---------------------------------------------------------------------------

const WAKE_PATTERNS = [
  /\bpearl[\s,]/i,
  /\bhey pearl\b/i,
  /\bpearl[,.]?\s*(can you|could you|please|show|display|summarize|pull up)/i,
];

/**
 * Returns true if the transcript text appears to be addressing Pearl directly.
 * Used by the bot to decide whether to respond in meeting mode.
 */
export function isAddressingPearl(text: string): boolean {
  return WAKE_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Meeting mode system prompt override
// ---------------------------------------------------------------------------

export const MEETING_MODE_SYSTEM_PROMPT = `## MEETING MODE (Active)
You are Pearl, a meeting assistant. You are listening to a group conversation.
Do NOT speak unless directly addressed by name ("Pearl", "Hey Pearl").
Your role is to:
1. Take running notes of the discussion (key points, action items, decisions).
2. Summarize discussions when asked.
3. Display information on Wonder Canvas when asked ("show", "pull up", "display").
Keep responses brief and professional when you do speak.
Never interrupt. Never offer unsolicited commentary.
If addressed, respond in 1-2 sentences max unless a longer answer is needed.`;
