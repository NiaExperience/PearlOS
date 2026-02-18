// DailyCall connection workflow instrumentation helpers.
// Gate all output behind env flag to avoid noisy logs in production & tests.

import { getClientLogger } from '@interface/lib/client-logger';

// Trigger env var renamed to DEBUG_DAILYCALL (fallback keeps old name temporarily)
// Accept flexible truthy values: "1", "true", "yes" (case-insensitive)
let ENABLED = false;
if (typeof process !== 'undefined') {
  const rawFlag =
    process.env.NEXT_PUBLIC_DEBUG_DAILYCALL ??
    process.env.DEBUG_DAILYCALL ??
    process.env.NEXT_PUBLIC_DEBUG_DAILYCALL_CONN;
  if (rawFlag && /^(1|true|yes)$/i.test(rawFlag.trim())) {
    ENABLED = true;
  }
}

type ConnPhase =
  | 'init.view.mount'
  | 'init.room.changed'
  | 'init.callobject.reuse'
  | 'init.callobject.create.start'
  | 'init.callobject.create.success'
  | 'init.callobject.create.error'
  | 'init.callobject.duplicate'
  | 'prejoin.username.change'
  | 'prejoin.username.prefill'
  | 'prejoin.join.click'
  | 'prejoin.username.autoset'
  | 'prejoin.autojoin.attempt'
  | 'join.effect.enter'
  | 'join.start'
  | 'join.success'
  | 'join.error'
  | 'join.cleanup.leave'
  | 'event.participant.joined'
  | 'event.participant.left'
  | 'event.left-meeting'
  | 'leave.user'
  | 'state.poll'
  // Bot legacy control phases (added)
  | 'bot..join.attempt'
  | 'bot..join.success'
  | 'bot..join.reuse'
  | 'bot..join.reused.force_new'
  | 'bot..join.reused.force_new.fail'
  | 'bot..join.null'
  | 'bot..join.error'
  | 'bot..join.base.missing'
  | 'bot..leave.success'
  | 'bot..leave.fail'
  | 'bot..leave.attempt'
  | 'bot..retention.defer'
  | 'bot..retention.inspect.error'
  // New: duplicate suppression + lifecycle explicit states
  | 'bot..join.duplicate_ignored'
  | 'bot..leave.duplicate_ignored'
  | 'bot.lifecycle.joined'
  | 'bot.lifecycle.left'
  | 'bot.lifecycle.leaving'
  | 'bot.lifecycle.leave.deferred'
  | 'bot.lifecycle.leave.beacon'
  | 'bot.lifecycle.leave.retry'
  | 'bot.lifecycle.leave.retry.success'
  | 'bot.lifecycle.leave.retry.fail'
  | 'bot.lifecycle.idempotent.key'
  // Noise cancellation phases
  | 'init.noise-cancellation.enabled'
  | 'init.noise-cancellation.error'
  | 'init.reuse.noise-cancellation.enabled'
  | 'init.reuse.noise-cancellation.error'
  // Audio processing phases
  | 'init.audio-processing.configured'
  | 'init.audio-processing.error';

interface LogPayload {
  phase: ConnPhase;
  ts: number;
  roomUrl?: string;
  username?: string;
  participantId?: string;
  joined?: boolean;
  local?: boolean;
  reason?: string;
  meetingState?: string;
  participantCount?: number;
  activeSpeakerId?: string | null;
  error?: string;
  data?: any;
  // Optional process/session id for legacy bot joins
  pid?: number;
}

const log = getClientLogger('[daily_call]');

export function logConn(payload: Omit<LogPayload, 'ts'>) {
  // if (!ENABLED) return;
  const record: LogPayload = { ...payload, ts: Date.now() };
  log.debug('Daily connection trace', {
    event: 'daily_conn_trace',
    phase: record.phase,
    roomUrl: record.roomUrl,
    username: record.username,
    participantId: record.participantId,
    joined: record.joined,
    local: record.local,
    reason: record.reason,
    meetingState: record.meetingState,
    participantCount: record.participantCount,
    activeSpeakerId: record.activeSpeakerId,
    error: record.error,
    pid: record.pid,
    data: record.data,
    ts: record.ts,
  });
  // For quick ad‑hoc inspection attach to window (non-enumerable) if available
  if (typeof window !== 'undefined') {
    const w: any = window as any;
    if (!w.__dailyConnLogs) w.__dailyConnLogs = [];
    w.__dailyConnLogs.push(record);
  }
}

// Optional polling helper to sample meeting state after join attempt.
export function scheduleStatePoll(getState: () => any, roomUrl: string, username?: string) {
  if (!ENABLED) return;
  const intervals = [500, 1500, 3000];
  intervals.forEach((ms) => {
    setTimeout(() => {
      try {
        const s = getState();
        logConn({ phase: 'state.poll', roomUrl, username, data: s });
      } catch (e: any) {
        logConn({ phase: 'state.poll', roomUrl, username, error: String(e) });
      }
    }, ms);
  });
}
