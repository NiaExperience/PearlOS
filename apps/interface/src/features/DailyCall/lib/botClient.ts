/* eslint-disable @typescript-eslint/no-explicit-any */
/* Lightweight legacy bot control client for /join */
import { getClientLogger } from '@interface/lib/client-logger';
import { normalizeVoiceParameters, type VoiceParametersInput } from '@interface/lib/voice/kokoro';

import { BOT_PERSONALITY } from './config';

// Use internal Next.js API proxy to avoid browser CORS issues.
const PROXY_JOIN = '/api/bot/join';
const PROXY_CONFIG = '/api/bot/config';
const log = getClientLogger('[daily_call]');

interface JoinResp { pid: number; room_url: string; personality: string; reused?: boolean;[k: string]: any }

interface BotJoinOptions {
  personalityId?: string;
  tenantId?: string;
  callIntentId?: string;
  forceNew?: boolean; // bypass intent reuse on server (fresh session even if intent known)
  voice?: string;
  persona?: string;
  voiceParameters?: VoiceParametersInput;
  voiceProvider?: string;
  // Deterministic identity mapping (forwarded to bot control server)
  participantId?: string; // Real Daily.co participant ID for accurate identity file mapping
  sessionUserId?: string;
  sessionUserEmail?: string;
  sessionUserName?: string;
  sessionId?: string; // (Interface/OS session ID)
  supportedFeatures?: string[] | null; // Feature flags to enable specific bot capabilities
  modePersonalityVoiceConfig?: Record<string, any>; // Map of mode -> config for hot-switching
  sessionOverride?: Record<string, any>;
  token?: string;
  debugTraceId?: string;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timeoutError = new Error('Request timed out');
  const timeoutId = setTimeout(() => ctrl.abort(timeoutError), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json();
  } catch (error: unknown) {
    if (error === timeoutError || (error instanceof DOMException && error.name === 'AbortError')) {
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function joinRoom(room_url: string, joinOptions: BotJoinOptions = { personalityId: BOT_PERSONALITY, persona: 'Pearl', callIntentId: undefined, voice: undefined }): Promise<JoinResp | null> {
  // Call proxy endpoint in same origin (no CORS). Provide room_url & personality.
  try {
    const call_intent_id = joinOptions.callIntentId;
    const personalityId = joinOptions.personalityId || BOT_PERSONALITY;
    const tenantId = joinOptions.tenantId;
    const force_new = joinOptions.forceNew || false;
    const voice = joinOptions.voice;
    const voiceParameters = joinOptions.voiceParameters;
    const voiceProvider = joinOptions.voiceProvider;
    const persona = joinOptions.persona || 'Pearl';
    const participantId = joinOptions.participantId;
    const sessionUserId = joinOptions.sessionUserId;
    const sessionUserEmail = joinOptions.sessionUserEmail;
    const sessionUserName = joinOptions.sessionUserName;
    const sessionId = joinOptions.sessionId;
    const token = joinOptions.token;
    const debugTraceId = joinOptions.debugTraceId;
    const supportedFeatures = joinOptions.supportedFeatures;
    const modePersonalityVoiceConfig = joinOptions.modePersonalityVoiceConfig;
    const sessionOverride = joinOptions.sessionOverride;
    const normalizedVoiceParameters = normalizeVoiceParameters(
      voiceProvider,
      voice,
      voiceParameters,
    );

    log.info('[botClient.joinRoom] outbound payload (sanitized)', {
      room_url,
      personalityId,
      persona,
      tenantId,
      voice,
      voiceProvider,
      hasVoiceParameters: !!normalizedVoiceParameters,
      supportedFeatures,
      modeConfigKeys: Object.keys(modePersonalityVoiceConfig || {}),
      sessionId,
      sessionUserId,
      sessionUserEmail: sessionUserEmail ? 'present' : 'absent',
      sessionUserName,
      sessionOverride: sessionOverride ? 'present' : 'absent',
      hasToken: !!token,
      debugTraceId,
    });

    return await fetchJson(PROXY_JOIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_url: room_url,
        personalityId,
        persona,
        tenantId,
        call_intent_id,
        force_new,
        voice,
        voiceParameters: normalizedVoiceParameters,
        ...(voiceProvider ? { voiceProvider } : {}),
        // Identity fields are forwarded to bot server which will emit a daily.participant.identity event
        ...(participantId ? { participantId } : {}),
        ...(sessionUserId ? { sessionUserId } : {}),
        ...(sessionUserEmail ? { sessionUserEmail } : {}),
        ...(sessionUserName ? { sessionUserName } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(supportedFeatures ? { supportedFeatures } : {}),
        ...(modePersonalityVoiceConfig ? { modePersonalityVoiceConfig } : {}),
        ...(sessionOverride ? { sessionOverride } : {}),
        ...(token ? { token } : {}),
        ...(debugTraceId ? { debugTraceId } : {}),
      })
    });
  } catch (e: any) {
    // Provide richer diagnostics (SSL / DNS / CORS vs HTTP error)
    const msg = e?.message || String(e);
    let hint = '';
    if (/Failed to fetch/i.test(msg) || /TypeError: fetch/i.test(msg)) {
      hint = ' (network layer: possible DNS, SSL certificate CN mismatch, or CORS preflight failure)';
    } else if (/abort/i.test(msg)) {
      hint = ' (request aborted - timeout)';
    }
    log.warn('joinRoom failed', {
      event: 'bot_join_room_failed',
      message: msg,
      hint,
      intent: joinOptions.callIntentId || 'n/a',
    });
    // Re-throw so caller can distinguish an error (instrumentation will log bot..join.error)
    throw e;
  }
}

export async function updateBotConfig(
  room_url: string,
  config: {
    personalityId?: string;
    voice?: any;
    mode?: string;
    persona?: string;
  },
  identity?: {
    sessionId?: string;
    sessionUserId?: string;
    sessionUserEmail?: string;
    sessionUserName?: string;
  }
): Promise<any> {
  const voiceObj = config.voice || {};
  const voiceId = voiceObj.voiceId;
  const voiceProvider = voiceObj.provider;

  const normalizedVoiceParameters = normalizeVoiceParameters(
    voiceProvider,
    voiceId,
    voiceObj,
  );

  const sessionId = identity?.sessionId;
  const sessionUserId = identity?.sessionUserId;
  const sessionUserEmail = identity?.sessionUserEmail;
  const sessionUserName = identity?.sessionUserName;

  try {
    return await fetchJson(PROXY_CONFIG, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'x-session-id': sessionId } : {}),
        ...(sessionUserId ? { 'x-user-id': sessionUserId } : {}),
        ...(sessionUserName ? { 'x-user-name': sessionUserName } : {}),
        ...(sessionUserEmail ? { 'x-user-email': sessionUserEmail } : {}),
      },
      body: JSON.stringify({
        room_url,
        sessionId,
        sessionUserId,
        sessionUserEmail,
        sessionUserName,
        personalityId: config.personalityId,
        voice: voiceId,
        voiceProvider: voiceProvider,
        voiceParameters: normalizedVoiceParameters,
        mode: config.mode,
        ...(config.persona ? { persona: config.persona } : {}),
      })
    }, 10000);
  } catch (error: any) {
    const msg = error?.message || String(error);
    const isTimeout = /timed out|abort/i.test(msg);
    const meta = {
      event: 'bot_config_update_failed',
      room_url,
      mode: config.mode,
      personalityId: config.personalityId,
      voiceProvider,
      voiceId,
      message: msg,
    };
    if (isTimeout) {
      log.warn('updateBotConfig timed out', meta);
      return null;
    }
    log.error('updateBotConfig failed', meta);
    throw error;
  }
}

// server now auto-reaps sessions; no explicit client leave.
