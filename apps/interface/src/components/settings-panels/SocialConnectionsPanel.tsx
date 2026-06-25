'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Button } from '@interface/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

type PlatformId = 'discord' | 'telegram' | 'google-chat';

const PLATFORM_META: Record<PlatformId, { label: string; icon: ReactNode }> = {
  discord: {
    label: 'Discord',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-[#5865F2]">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.25-.191.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
  },
  telegram: {
    label: 'Telegram',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-[#26A5E4]">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  'google-chat': {
    label: 'Google Chat',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path d="M5.25 3.5h13.5A2.75 2.75 0 0 1 21.5 6.25v8.5a2.75 2.75 0 0 1-2.75 2.75h-5.7l-4.33 3.03a.75.75 0 0 1-1.18-.61V17.5H5.25A2.75 2.75 0 0 1 2.5 14.75v-8.5A2.75 2.75 0 0 1 5.25 3.5Z" fill="#34A853" />
        <path d="M8 8.25h8" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M8 12h5.5" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
};

type DiscordStatus =
  | { state: 'loading' }
  | { state: 'unauthenticated' }
  | { state: 'not_connected'; oauthConfigured: boolean }
  | { state: 'connected'; discordUserId: string; scope?: string; oauthConfigured: boolean };

type DmLinkStatus =
  | { state: 'loading' }
  | { state: 'unauthenticated' }
  | { state: 'not_linked' }
  | { state: 'code_sent'; discordUserId?: string; code: string; expiresAt?: string }
  | { state: 'linked'; discordUserId: string; verifiedAt?: string };

type TelegramLinkStatus =
  | { state: 'loading' }
  | { state: 'unauthenticated' }
  | { state: 'not_linked' }
  | { state: 'awaiting_message'; code: string; botUsername?: string; expiresAt?: string }
  | { state: 'code_sent'; expiresAt?: string }
  | { state: 'linked'; telegramUserId: string; telegramUsername?: string; verifiedAt?: string };

type GoogleChatLinkStatus =
  | { state: 'loading' }
  | { state: 'disabled'; reasons?: string[]; oauthConfigured?: boolean }
  | { state: 'unauthenticated' }
  | {
      state: 'not_linked';
      chatAppUrl?: string;
      chatAppName?: string;
      pearlOsGoogleEmail?: string;
      oauthConfigured?: boolean;
      reason?: string;
    }
  | {
      state: 'code_sent';
      code?: string;
      expiresAt?: string;
      chatAppUrl?: string;
      chatAppName?: string;
      pearlOsGoogleEmail?: string;
      oauthConfigured?: boolean;
    }
  | {
      state: 'linked';
      googleChatUserName: string;
      googleChatDisplayName?: string;
      googleChatUserEmail?: string;
      googleChatSpaceUri?: string;
      verifiedAt?: string;
      chatAppUrl?: string;
      chatAppName?: string;
      pearlOsGoogleEmail?: string;
      oauthConfigured?: boolean;
    };

const CONNECT_FEEDBACK: Record<string, { kind: 'success' | 'error'; message: string }> = {
  joined: { kind: 'success', message: 'Connected to Discord and added you to Pearl Village.' },
  already_member: { kind: 'success', message: 'Connected to Discord. You were already in Pearl Village.' },
  pending_screening: { kind: 'success', message: 'Connected. Pearl Village requires membership screening — check Discord to finish joining.' },
  join_skipped: { kind: 'success', message: 'Connected to Discord.' },
  join_failed: { kind: 'success', message: 'Connected to Discord, but auto-join to Pearl Village failed. You can join manually.' },
  oauth_not_configured: { kind: 'error', message: 'Discord OAuth is not configured on the server.' },
  not_signed_in: { kind: 'error', message: 'You need to sign in before connecting Discord.' },
  state_mismatch: { kind: 'error', message: 'Discord login state mismatch. Try again.' },
  state_expired: { kind: 'error', message: 'Discord login took too long. Try again.' },
  session_user_mismatch: { kind: 'error', message: 'You signed in to a different account mid-flow. Try again.' },
  missing_state_cookie: { kind: 'error', message: 'Login cookie missing. Make sure cookies are enabled and try again.' },
  malformed_state_cookie: { kind: 'error', message: 'Login cookie corrupted. Try again.' },
  missing_code_or_state: { kind: 'error', message: 'Discord did not return a valid response. Try again.' },
  token_exchange_failed: { kind: 'error', message: 'Discord rejected the token exchange.' },
  identity_fetch_failed: { kind: 'error', message: 'Could not fetch your Discord identity. Try again.' },
  persist_failed: { kind: 'error', message: 'Connected to Discord, but saving the link failed. Try again.' },
};

const GOOGLE_CHAT_CONNECT_FEEDBACK: Record<string, { kind: 'success' | 'error'; message: string }> = {
  connected: { kind: 'success', message: 'Google Chat connected. Pearl opened a private DM for this Google account.' },
  not_configured: { kind: 'error', message: 'Google Chat is not ready on this server yet.' },
  oauth_not_configured: { kind: 'error', message: 'Google Chat OAuth is not configured yet.' },
  google_account_required: { kind: 'error', message: 'Sign in to PearlOS with Google before connecting Google Chat.' },
  google_chat_public_tenant_required: { kind: 'error', message: 'This Google Chat connector is only for Public Pearl.' },
  google_account_mismatch: { kind: 'error', message: 'Google returned a different account. Use the same Google account you use for PearlOS.' },
  google_chat_setup_failed: { kind: 'error', message: 'Google Chat did not create the Pearl DM. Try the code fallback or reconnect.' },
  chat_scope_not_granted: { kind: 'error', message: 'Google Chat permission was not granted.' },
};

function googleChatReasonMessage(reason?: string): string {
  if (!reason) return '';
  return GOOGLE_CHAT_CONNECT_FEEDBACK[reason]?.message || `Google Chat connection failed (${reason}).`;
}

function googleChatAppNameFrom(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  return name || 'Pearl';
}

const SectionShell = ({ children }: { children: ReactNode }) => (
  <div className="rounded-md border border-gray-700 bg-gray-900/35 p-3">
    {children}
  </div>
);

export function SocialConnectionsPanel() {
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>('discord');
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus>({ state: 'loading' });
  const [discordFlash, setDiscordFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [dmLinkStatus, setDmLinkStatus] = useState<DmLinkStatus>({ state: 'loading' });
  const [dmLinkError, setDmLinkError] = useState('');
  const [dmLinkBusy, setDmLinkBusy] = useState(false);
  const [telegramLinkStatus, setTelegramLinkStatus] = useState<TelegramLinkStatus>({ state: 'loading' });
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramLinkError, setTelegramLinkError] = useState('');
  const [telegramLinkBusy, setTelegramLinkBusy] = useState(false);
  const [googleChatLinkStatus, setGoogleChatLinkStatus] = useState<GoogleChatLinkStatus>({ state: 'loading' });
  const [googleChatLinkError, setGoogleChatLinkError] = useState('');
  const [googleChatFlash, setGoogleChatFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [googleChatLinkBusy, setGoogleChatLinkBusy] = useState(false);
  const [googleChatCommandCopied, setGoogleChatCommandCopied] = useState(false);

  const refreshDiscordStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/discord/status', { credentials: 'include' });
      if (res.status === 401) {
        setDiscordStatus({ state: 'unauthenticated' });
        return;
      }
      const data = await res.json();
      if (data.connected) {
        const discordUserId = String(data.discordUserId);
        setDiscordStatus({
          state: 'connected',
          discordUserId,
          scope: data.scope,
          oauthConfigured: Boolean(data.oauthConfigured),
        });
      } else {
        setDiscordStatus({ state: 'not_connected', oauthConfigured: Boolean(data.oauthConfigured) });
      }
    } catch {
      setDiscordStatus({ state: 'not_connected', oauthConfigured: false });
    }
  }, []);

  const refreshDmLinkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/discord/dm-link', { credentials: 'include' });
      if (res.status === 401) {
        setDmLinkStatus({ state: 'unauthenticated' });
        return;
      }
      const data = await res.json();
      if (data.linked) {
        const discordUserId = String(data.discordUserId);
        setDmLinkStatus({
          state: 'linked',
          discordUserId,
          verifiedAt: data.verifiedAt ? String(data.verifiedAt) : undefined,
        });
      } else {
        setDmLinkStatus({ state: 'not_linked' });
      }
    } catch {
      setDmLinkStatus({ state: 'not_linked' });
    }
  }, []);

  const refreshTelegramLinkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/dm-link', { credentials: 'include' });
      if (res.status === 401) {
        setTelegramLinkStatus({ state: 'unauthenticated' });
        return;
      }
      const data = await res.json();
      if (data.linked) {
        setTelegramLinkStatus({
          state: 'linked',
          telegramUserId: String(data.telegramUserId),
          telegramUsername: data.telegramUsername ? String(data.telegramUsername) : undefined,
          verifiedAt: data.verifiedAt ? String(data.verifiedAt) : undefined,
        });
      } else {
        setTelegramLinkStatus({ state: 'not_linked' });
      }
    } catch {
      setTelegramLinkStatus({ state: 'not_linked' });
    }
  }, []);

  const refreshGoogleChatLinkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/google-chat/dm-link', { credentials: 'include' });
      if (res.status === 401) {
        setGoogleChatLinkStatus({ state: 'unauthenticated' });
        return;
      }
      const data = await res.json();
      if (res.status === 404 || data.enabled === false) {
        setGoogleChatLinkStatus({
          state: 'disabled',
          reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : undefined,
          oauthConfigured: Boolean(data.oauthConfigured),
        });
        return;
      }
      const chatAppUrl = typeof data.chatAppUrl === 'string' ? data.chatAppUrl : undefined;
      const chatAppName = googleChatAppNameFrom(data.chatAppName);
      const pearlOsGoogleEmail = typeof data.pearlOsGoogleEmail === 'string' ? data.pearlOsGoogleEmail : undefined;
      const oauthConfigured = Boolean(data.oauthConfigured);
      if (res.status === 403) {
        const reason = typeof data.reason === 'string' ? data.reason : 'google_account_required';
        setGoogleChatLinkStatus({
          state: 'not_linked',
          chatAppUrl,
          chatAppName,
          pearlOsGoogleEmail,
          oauthConfigured,
          reason,
        });
        setGoogleChatLinkError(googleChatReasonMessage(reason));
        return;
      }
      if (data.linked) {
        setGoogleChatLinkStatus({
          state: 'linked',
          googleChatUserName: String(data.googleChatUserName),
          googleChatDisplayName: data.googleChatDisplayName ? String(data.googleChatDisplayName) : undefined,
          googleChatUserEmail: data.googleChatUserEmail ? String(data.googleChatUserEmail) : undefined,
          googleChatSpaceUri: data.googleChatSpaceUri ? String(data.googleChatSpaceUri) : undefined,
          verifiedAt: data.verifiedAt ? String(data.verifiedAt) : undefined,
          chatAppUrl,
          chatAppName,
          pearlOsGoogleEmail,
          oauthConfigured,
        });
      } else if (data.pending) {
        setGoogleChatLinkStatus({
          state: 'code_sent',
          expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
          chatAppUrl,
          chatAppName,
          pearlOsGoogleEmail,
          oauthConfigured,
        });
      } else {
        setGoogleChatLinkStatus({ state: 'not_linked', chatAppUrl, chatAppName, pearlOsGoogleEmail, oauthConfigured });
      }
    } catch {
      setGoogleChatLinkStatus({ state: 'not_linked' });
    }
  }, []);

  useEffect(() => {
    refreshDiscordStatus();
    refreshDmLinkStatus();
    refreshTelegramLinkStatus();
    refreshGoogleChatLinkStatus();
  }, [refreshDiscordStatus, refreshDmLinkStatus, refreshTelegramLinkStatus, refreshGoogleChatLinkStatus]);

  const disconnectDiscord = useCallback(async () => {
    setDmLinkBusy(true);
    setDmLinkError('');
    setDiscordFlash(null);
    try {
      const res = await fetch('/api/discord/status', { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        setDiscordFlash({ kind: 'error', message: data.error || 'Failed to disconnect Discord.' });
        return;
      }
      setDiscordStatus({ state: 'not_connected', oauthConfigured: true });
      setDmLinkStatus({ state: 'not_linked' });
      setDiscordFlash({ kind: 'success', message: 'Discord disconnected and Pearl DM access removed.' });
    } catch {
      setDiscordFlash({ kind: 'error', message: 'Network error — failed to disconnect Discord.' });
    } finally {
      setDmLinkBusy(false);
    }
  }, []);

  const openDiscordOAuth = useCallback(() => {
    const width = 520;
    const height = 760;
    const left = window.screenX + Math.max(0, Math.round((window.outerWidth - width) / 2));
    const top = window.screenY + Math.max(0, Math.round((window.outerHeight - height) / 2));
    const popup = window.open(
      '/api/discord/auth?popup=1',
      'pearl_discord_oauth',
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
    if (!popup) {
      window.location.href = '/api/discord/auth';
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'discord.oauth-success') {
        setDiscordFlash({ kind: 'success', message: 'Discord connected. Generate a Pearl DM code and send it to Pearl in Discord.' });
        refreshDiscordStatus();
        refreshDmLinkStatus();
      } else if (event.data?.type === 'discord.oauth-error') {
        const detail = String(event.data.error || 'unknown');
        const feedback = CONNECT_FEEDBACK[detail];
        setDiscordFlash(feedback ?? {
          kind: 'error',
          message: `Discord connection failed (${detail}).`,
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshDiscordStatus, refreshDmLinkStatus]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'google-chat.oauth-success') {
        const detail = String(event.data.detail || 'connected');
        const feedback = GOOGLE_CHAT_CONNECT_FEEDBACK[detail] || GOOGLE_CHAT_CONNECT_FEEDBACK.connected;
        setGoogleChatFlash(feedback);
        setGoogleChatLinkError('');
        refreshGoogleChatLinkStatus();
      } else if (event.data?.type === 'google-chat.oauth-error') {
        const detail = String(event.data.error || 'unknown');
        setGoogleChatFlash(googleChatReasonMessage(detail)
          ? { kind: 'error', message: googleChatReasonMessage(detail) }
          : { kind: 'error', message: `Google Chat connection failed (${detail}).` });
        refreshGoogleChatLinkStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshGoogleChatLinkStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('google_chat_connect');
    if (!status) return;
    const detail = params.get('google_chat_detail') || (status === 'success' ? 'connected' : 'unknown');
    const feedback = status === 'success'
      ? GOOGLE_CHAT_CONNECT_FEEDBACK[detail] || GOOGLE_CHAT_CONNECT_FEEDBACK.connected
      : { kind: 'error' as const, message: googleChatReasonMessage(detail) || `Google Chat connection failed (${detail}).` };
    setGoogleChatFlash(feedback);
    if (feedback.kind === 'success') setGoogleChatLinkError('');
    params.delete('google_chat_connect');
    params.delete('google_chat_detail');
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    refreshGoogleChatLinkStatus();
  }, [refreshGoogleChatLinkStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('discord_connect');
    if (!status) return;
    const detail = params.get('discord_detail') || (status === 'success' ? 'joined' : 'unknown');
    const feedback = CONNECT_FEEDBACK[detail];
    setDiscordFlash(feedback ?? {
      kind: status === 'success' ? 'success' : 'error',
      message: status === 'success' ? 'Discord connected.' : `Discord connection failed (${detail}).`,
    });
    params.delete('discord_connect');
    params.delete('discord_detail');
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    refreshDiscordStatus();
    refreshDmLinkStatus();
    if (status === 'success') {
      setDiscordFlash({ kind: 'success', message: 'Discord connected. Generate a Pearl DM code and send it to Pearl in Discord.' });
    }
  }, [refreshDiscordStatus, refreshDmLinkStatus]);

  const sendVerificationCode = useCallback(async () => {
    setDmLinkBusy(true);
    setDmLinkError('');
    try {
      const res = await fetch('/api/discord/dm-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setDmLinkError(data.error || 'Failed to create verification code');
        return;
      }
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        setDmLinkError('Server did not return a Discord verification code.');
        return;
      }
      setDmLinkStatus({
        state: 'code_sent',
        code,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
      });
    } catch {
      setDmLinkError('Network error — could not reach Pearl.');
    } finally {
      setDmLinkBusy(false);
    }
  }, []);

  const disableDmLink = useCallback(async () => {
    setDmLinkBusy(true);
    setDmLinkError('');
    try {
      const res = await fetch('/api/discord/dm-link', { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        setDmLinkError(data.error || 'Failed to disable Pearl DMs');
        return;
      }
      setDmLinkStatus({ state: 'not_linked' });
    } catch {
      setDmLinkError('Network error — failed to disable Pearl DMs.');
    } finally {
      setDmLinkBusy(false);
    }
  }, []);

  const sendTelegramVerificationCode = useCallback(async () => {
    setTelegramLinkBusy(true);
    setTelegramLinkError('');
    try {
      const res = await fetch('/api/telegram/dm-link/request', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setTelegramLinkError(data.error || 'Failed to create Telegram code');
        return;
      }
      const code = typeof data.code === 'string' ? data.code : '';
      if (!code) {
        setTelegramLinkError('Server did not return a Telegram verification code.');
        return;
      }
      setTelegramCode(code);
      setTelegramLinkStatus({
        state: 'awaiting_message',
        code,
        botUsername: typeof data.botUsername === 'string' ? data.botUsername : undefined,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
      });
    } catch {
      setTelegramLinkError('Network error — could not reach Pearl.');
    } finally {
      setTelegramLinkBusy(false);
    }
  }, []);

  const verifyTelegramCode = useCallback(async () => {
    setTelegramLinkBusy(true);
    setTelegramLinkError('');
    try {
      const res = await fetch('/api/telegram/dm-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: telegramCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTelegramLinkError(data.error || 'Verification failed');
        return;
      }
      setTelegramLinkStatus({
        state: 'linked',
        telegramUserId: String(data.telegramUserId),
        telegramUsername: data.telegramUsername ? String(data.telegramUsername) : undefined,
        verifiedAt: data.verifiedAt ? String(data.verifiedAt) : undefined,
      });
      setTelegramCode('');
    } catch {
      setTelegramLinkError('Network error — verification failed.');
    } finally {
      setTelegramLinkBusy(false);
    }
  }, [telegramCode]);

  const disableTelegramLink = useCallback(async () => {
    setTelegramLinkBusy(true);
    setTelegramLinkError('');
    try {
      const res = await fetch('/api/telegram/dm-link', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setTelegramLinkError(data.error || 'Failed to disable Telegram DMs');
        return;
      }
      setTelegramLinkStatus({ state: 'not_linked' });
      setTelegramCode('');
    } catch {
      setTelegramLinkError('Network error — failed to disable Telegram DMs.');
    } finally {
      setTelegramLinkBusy(false);
    }
  }, []);

  const sendGoogleChatVerificationCode = useCallback(async () => {
    setGoogleChatLinkBusy(true);
    setGoogleChatLinkError('');
    setGoogleChatFlash(null);
    try {
      const res = await fetch('/api/google-chat/dm-link/request', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setGoogleChatLinkError(data.error || data.reason || 'Failed to create Google Chat code');
        return;
      }
      const code = typeof data.code === 'string' ? data.code : '';
      if (!code) {
        setGoogleChatLinkError('Server did not return a Google Chat verification code.');
        return;
      }
      setGoogleChatLinkStatus({
        state: 'code_sent',
        code,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
        chatAppUrl: typeof data.chatAppUrl === 'string' ? data.chatAppUrl : undefined,
        chatAppName: googleChatAppNameFrom(data.chatAppName),
        pearlOsGoogleEmail: typeof data.pearlOsGoogleEmail === 'string' ? data.pearlOsGoogleEmail : (
          'pearlOsGoogleEmail' in googleChatLinkStatus ? googleChatLinkStatus.pearlOsGoogleEmail : undefined
        ),
        oauthConfigured: 'oauthConfigured' in googleChatLinkStatus ? googleChatLinkStatus.oauthConfigured : undefined,
      });
    } catch {
      setGoogleChatLinkError('Network error — could not reach Pearl.');
    } finally {
      setGoogleChatLinkBusy(false);
    }
  }, [googleChatLinkStatus]);

  const disableGoogleChatLink = useCallback(async () => {
    setGoogleChatLinkBusy(true);
    setGoogleChatLinkError('');
    try {
      const res = await fetch('/api/google-chat/dm-link', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setGoogleChatLinkError(data.error || data.reason || 'Failed to disable Google Chat');
        return;
      }
      setGoogleChatLinkStatus({
        state: 'not_linked',
        chatAppUrl: typeof data.chatAppUrl === 'string' ? data.chatAppUrl : undefined,
        chatAppName: googleChatAppNameFrom(data.chatAppName),
      });
    } catch {
      setGoogleChatLinkError('Network error — failed to disable Google Chat.');
    } finally {
      setGoogleChatLinkBusy(false);
    }
  }, []);

  const googleChatLinkCommand = googleChatLinkStatus.state === 'code_sent' && googleChatLinkStatus.code
    ? `link ${googleChatLinkStatus.code}`
    : '';
  const googleChatOpenUrl = googleChatLinkStatus.state === 'code_sent' && googleChatLinkStatus.chatAppUrl
    ? `${googleChatLinkStatus.chatAppUrl}${googleChatLinkStatus.chatAppUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(googleChatLinkCommand)}`
    : '';
  const googleChatConnectedUrl = googleChatLinkStatus.state === 'linked'
    ? googleChatLinkStatus.googleChatSpaceUri || googleChatLinkStatus.chatAppUrl || ''
    : '';
  const googleChatExpectedEmail = 'pearlOsGoogleEmail' in googleChatLinkStatus
    ? googleChatLinkStatus.pearlOsGoogleEmail
    : undefined;
  const googleChatAppName = 'chatAppName' in googleChatLinkStatus
    ? googleChatAppNameFrom(googleChatLinkStatus.chatAppName)
    : 'Pearl';
  const googleChatCanOAuth = 'oauthConfigured' in googleChatLinkStatus
    ? googleChatLinkStatus.oauthConfigured !== false
    : false;
  const googleChatCodeNeedsAppLink = googleChatLinkStatus.state === 'code_sent' && !googleChatOpenUrl;

  const copyGoogleChatLinkCommand = useCallback(async () => {
    if (!googleChatLinkCommand) return;
    try {
      await navigator.clipboard.writeText(googleChatLinkCommand);
      setGoogleChatCommandCopied(true);
      window.setTimeout(() => setGoogleChatCommandCopied(false), 1800);
    } catch {
      setGoogleChatLinkError('Copy failed. Select the command and paste it into Pearl in Google Chat.');
    }
  }, [googleChatLinkCommand]);

  const selectedMeta = PLATFORM_META[selectedPlatform];

  return (
    <Card className="border-gray-700 bg-gray-800" style={FONT}>
      <CardHeader className="space-y-2">
        <CardTitle className="text-white" style={FONT}>Connections</CardTitle>
        <CardDescription className="space-y-1 text-gray-400" style={FONT}>
          <span className="block text-sm text-gray-300">You can chat w Pearl in places you already use!</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" style={FONT}>
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Connection platform">
          {(Object.keys(PLATFORM_META) as PlatformId[]).map((id) => {
            const selected = selectedPlatform === id;
            const meta = PLATFORM_META[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedPlatform(id)}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                  selected
                    ? 'border-blue-500 bg-gray-900 ring-2 ring-blue-500/35'
                    : 'border-gray-700 bg-gray-900/40 text-gray-300 hover:bg-gray-900'
                }`}
                style={FONT}
              >
                {meta.icon}
                <span className="truncate text-sm">{meta.label}</span>
              </button>
            );
          })}
        </div>

        {selectedPlatform === 'discord' ? (
          <SectionShell>
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-gray-300" style={FONT}>
                  {discordStatus.state === 'loading' && 'Checking Discord…'}
                  {discordStatus.state === 'unauthenticated' && 'Sign in to connect Discord.'}
                  {discordStatus.state === 'not_connected' && 'Connect PearlOS to Discord.'}
                  {discordStatus.state === 'connected' && `Linked as Discord user ${discordStatus.discordUserId}`}
                </div>
                {discordStatus.state === 'not_connected' && (
                  <button
                    type="button"
                    onClick={openDiscordOAuth}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-[#5865F2] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4752C4]"
                    style={FONT}
                  >
                    Connect Discord
                  </button>
                )}
                {discordStatus.state === 'connected' && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openDiscordOAuth}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-gray-600 bg-gray-800 px-3 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
                      style={FONT}
                    >
                      Reconnect
                    </button>
                    <button
                      type="button"
                      onClick={disconnectDiscord}
                      disabled={dmLinkBusy}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-red-500/60 bg-red-950/40 px-3 text-xs font-medium text-red-100 transition-colors hover:bg-red-900/50 disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
                      style={FONT}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>

              {discordStatus.state === 'not_connected' && !discordStatus.oauthConfigured ? (
                <p className="text-xs text-amber-400" style={FONT}>
                  Discord OAuth is not configured on this server.
                </p>
              ) : null}

              {discordFlash ? (
                <p className={`text-xs ${discordFlash.kind === 'success' ? 'text-green-400' : 'text-red-400'}`} style={FONT}>
                  {discordFlash.message}
                </p>
              ) : null}

              {discordStatus.state !== 'loading' && discordStatus.state !== 'unauthenticated' ? (
                <div className="space-y-2 border-t border-gray-700 pt-3">
                  <Label className="text-xs text-gray-300" style={FONT}>
                    Pearl DMs
                  </Label>
                  {dmLinkStatus.state === 'linked' ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-green-400" style={FONT}>
                        Linked for Discord user {dmLinkStatus.discordUserId}
                      </p>
                      <Button
                        type="button"
                        onClick={disableDmLink}
                        disabled={dmLinkBusy}
                        className="h-9 border border-gray-600 bg-gray-700 px-3 text-sm text-gray-100 hover:bg-gray-600"
                        style={FONT}
                      >
                        Remove connection
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {discordStatus.state === 'connected' && dmLinkStatus.state !== 'code_sent' ? (
                        <p className="text-xs text-gray-400" style={FONT}>
                          Generate a code, send it to Pearl in a Discord DM, then check the connection here.
                        </p>
                      ) : null}
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          onClick={sendVerificationCode}
                          disabled={dmLinkBusy}
                          className="h-10 bg-gray-700 px-4 text-sm text-gray-100 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500"
                          style={FONT}
                        >
                          {dmLinkBusy ? 'Generating...' : dmLinkStatus.state === 'code_sent' ? 'Regenerate code' : 'Get Discord code'}
                        </Button>
                      </div>
                      {dmLinkStatus.state === 'code_sent' ? (
                        <div className="space-y-2">
                          <div className="inline-flex rounded-md border border-[#7C86FF]/70 bg-gray-950 px-3 py-2 font-mono text-sm tracking-[0.25em] text-white">
                            {dmLinkStatus.code}
                          </div>
                          <p className="text-xs text-gray-400" style={FONT}>
                            Send this exact code to Pearl in a Discord DM. Pearl will link the Discord account that sends it.
                          </p>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <a
                              href="https://discord.com/channels/@me"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center justify-center rounded-md border border-[#7C86FF] bg-[#5865F2] px-3 text-sm font-medium text-white transition-colors hover:bg-[#4752C4]"
                              style={FONT}
                            >
                              Open Discord
                            </a>
                          <Button
                            type="button"
                            onClick={refreshDmLinkStatus}
                            disabled={dmLinkBusy}
                            className="h-9 bg-gray-700 px-3 text-sm text-gray-100 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400"
                            style={FONT}
                          >
                            I sent it
                          </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                  {dmLinkError ? <p className="text-xs text-red-400" style={FONT}>{dmLinkError}</p> : null}
                </div>
              ) : null}
            </div>
          </SectionShell>
        ) : selectedPlatform === 'telegram' ? (
          <SectionShell>
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-gray-300" style={FONT}>
                  {telegramLinkStatus.state === 'loading' && 'Checking Telegram…'}
                  {telegramLinkStatus.state === 'unauthenticated' && 'Sign in to connect Telegram.'}
                  {telegramLinkStatus.state === 'not_linked' && 'Connect PearlOS to Telegram.'}
                  {telegramLinkStatus.state === 'awaiting_message' && `Send this code to @${telegramLinkStatus.botUsername || 'PearlOS_bot'}.`}
                  {telegramLinkStatus.state === 'code_sent' && 'Enter the Telegram verification code.'}
                  {telegramLinkStatus.state === 'linked' &&
                    `Linked as ${telegramLinkStatus.telegramUsername ? `@${telegramLinkStatus.telegramUsername}` : telegramLinkStatus.telegramUserId}`}
                </div>
                {telegramLinkStatus.state !== 'loading' && telegramLinkStatus.state !== 'unauthenticated' && telegramLinkStatus.state !== 'linked' ? (
                  <Button
                    type="button"
                    onClick={sendTelegramVerificationCode}
                    disabled={telegramLinkBusy}
                    className="h-10 bg-[#26A5E4] px-4 text-sm font-semibold text-white hover:bg-[#1688C5] disabled:bg-gray-800 disabled:text-gray-500"
                    style={FONT}
                  >
                    {telegramLinkBusy ? 'Generating…' : telegramLinkStatus.state === 'awaiting_message' || telegramLinkStatus.state === 'code_sent' ? 'Regenerate code' : 'Get Telegram code'}
                  </Button>
                ) : null}
                {telegramLinkStatus.state === 'linked' ? (
                  <Button
                    type="button"
                    onClick={disableTelegramLink}
                    disabled={telegramLinkBusy}
                    className="h-9 border border-gray-600 bg-gray-700 px-3 text-sm text-gray-100 hover:bg-gray-600"
                    style={FONT}
                  >
                    Disable
                  </Button>
                ) : null}
              </div>

              {telegramLinkStatus.state === 'awaiting_message' || telegramLinkStatus.state === 'code_sent' ? (
                <div className="space-y-2">
                  {'code' in telegramLinkStatus ? (
                    <div className="inline-flex rounded-md border border-[#55B8EA]/70 bg-gray-950 px-3 py-2 font-mono text-sm tracking-[0.25em] text-white">
                      {telegramLinkStatus.code}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <a
                      href={`https://t.me/${'botUsername' in telegramLinkStatus && telegramLinkStatus.botUsername ? telegramLinkStatus.botUsername : 'PearlOS_bot'}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center justify-center rounded-md border border-[#55B8EA] bg-[#26A5E4] px-3 text-sm font-medium text-white transition-colors hover:bg-[#1688C5]"
                      style={FONT}
                    >
                      Open Telegram
                    </a>
                    <Button
                      type="button"
                      onClick={refreshTelegramLinkStatus}
                      disabled={telegramLinkBusy}
                      className="h-9 bg-gray-700 px-3 text-sm text-gray-100 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400"
                      style={FONT}
                    >
                      I sent it
                    </Button>
                  </div>
                  {telegramLinkStatus.state === 'code_sent' ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        aria-label="Verification code"
                        value={telegramCode}
                        onChange={(e) => setTelegramCode(e.target.value.toUpperCase())}
                        placeholder="A1B2C3"
                        maxLength={6}
                        className="border-gray-700 bg-gray-800 text-white tracking-widest"
                        style={FONT}
                        disabled={telegramLinkBusy}
                      />
                      <Button
                        type="button"
                        onClick={verifyTelegramCode}
                        disabled={telegramLinkBusy || telegramCode.trim().length !== 6}
                        className="h-10 bg-[#26A5E4] px-4 text-sm text-white hover:bg-[#1688C5] disabled:bg-gray-800 disabled:text-gray-500"
                        style={FONT}
                      >
                        Verify
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {telegramLinkError ? <p className="text-xs text-red-400" style={FONT}>{telegramLinkError}</p> : null}
            </div>
          </SectionShell>
        ) : (
          <SectionShell>
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-gray-300" style={FONT}>
                  {googleChatLinkStatus.state === 'loading' && 'Checking Google Chat...'}
                  {googleChatLinkStatus.state === 'disabled' && 'Google Chat is not ready yet.'}
                  {googleChatLinkStatus.state === 'unauthenticated' && 'Sign in to connect Google Chat.'}
                  {googleChatLinkStatus.state === 'not_linked' && 'Connect Google Chat to Public Pearl.'}
                  {googleChatLinkStatus.state === 'code_sent' && `Open ${googleChatAppName} in Google Chat, then send this command.`}
                  {googleChatLinkStatus.state === 'linked' &&
                    `Connected to Pearl in Google Chat as ${googleChatLinkStatus.googleChatUserEmail || googleChatLinkStatus.googleChatDisplayName || googleChatLinkStatus.googleChatUserName}`}
                </div>
                {googleChatLinkStatus.state === 'not_linked' && googleChatCanOAuth ? (
                  <a
                    href="/api/google-chat/oauth/start?returnTo=/pearlos/settings"
                    className="inline-flex h-10 items-center justify-center rounded-md bg-[#34A853] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#2B8A45]"
                    style={FONT}
                  >
                    Connect Google Chat
                  </a>
                ) : null}
                {googleChatLinkStatus.state === 'linked' ? (
                  <div className="flex flex-wrap gap-2">
                    {googleChatConnectedUrl ? (
                      <a
                        href={googleChatConnectedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center justify-center rounded-md border border-[#5BCB74] bg-[#34A853] px-3 text-sm font-medium text-white transition-colors hover:bg-[#2B8A45]"
                        style={FONT}
                      >
                        Open Pearl DM
                      </a>
                    ) : null}
                    <Button
                      type="button"
                      onClick={disableGoogleChatLink}
                      disabled={googleChatLinkBusy}
                      className="h-9 border border-gray-600 bg-gray-700 px-3 text-sm text-gray-100 hover:bg-gray-600"
                      style={FONT}
                    >
                      Disable
                    </Button>
                  </div>
                ) : null}
              </div>

              {googleChatExpectedEmail ? (
                <p className="text-xs text-gray-400" style={FONT}>
                  Uses your PearlOS Google account: {googleChatExpectedEmail}. Connect Google Chat first; Pearl then creates a private DM automatically.
                </p>
              ) : null}

              <p className="text-xs text-gray-400" style={FONT}>
                In group spaces Pearl only uses public profile information. Private questions and task results stay in your 1:1 chat with Pearl.
              </p>

              {googleChatLinkStatus.state === 'not_linked' && googleChatCanOAuth ? (
                <button
                  type="button"
                  onClick={sendGoogleChatVerificationCode}
                  disabled={googleChatLinkBusy}
                  className="text-left text-xs text-[#7CD992] underline-offset-4 hover:underline disabled:text-gray-500"
                  style={FONT}
                >
                  {googleChatLinkBusy ? 'Generating code...' : 'Having trouble? Use a code instead.'}
                </button>
              ) : null}

              {googleChatLinkStatus.state !== 'loading' && googleChatLinkStatus.state !== 'disabled' && googleChatLinkStatus.state !== 'unauthenticated' && googleChatLinkStatus.state !== 'linked' && !googleChatCanOAuth ? (
                <Button
                  type="button"
                  onClick={sendGoogleChatVerificationCode}
                  disabled={googleChatLinkBusy}
                  className="h-10 bg-[#34A853] px-4 text-sm font-semibold text-white hover:bg-[#2B8A45] disabled:bg-gray-800 disabled:text-gray-500"
                  style={FONT}
                >
                  {googleChatLinkBusy ? 'Generating...' : googleChatLinkStatus.state === 'code_sent' ? 'Regenerate code' : 'Get Google Chat code'}
                </Button>
              ) : null}

              {googleChatLinkStatus.state === 'code_sent' ? (
                <div className="space-y-2">
                  {googleChatLinkStatus.code ? (
                    <div className="inline-flex rounded-md border border-[#5BCB74]/70 bg-gray-950 px-3 py-2 font-mono text-sm tracking-[0.25em] text-white">
                      {googleChatLinkStatus.code}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400" style={FONT}>
                      A Google Chat code is pending. Generate a new one if you need to see it again.
                    </p>
                  )}
                  <p className="text-xs text-gray-400" style={FONT}>
                    Send this exact message to {googleChatAppName} in a 1:1 Google Chat DM: {googleChatLinkCommand || 'your code'}.
                  </p>
                  {googleChatCodeNeedsAppLink ? (
                    <p className="text-xs text-amber-300" style={FONT}>
                      PearlOS is missing the Google Chat app link, so this manual fallback cannot open the right DM yet. Use Connect Google Chat above, or configure GOOGLE_CHAT_APP_URL for this server.
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {googleChatOpenUrl ? (
                      <a
                        href={googleChatOpenUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center justify-center rounded-md border border-[#5BCB74] bg-[#34A853] px-3 text-sm font-medium text-white transition-colors hover:bg-[#2B8A45]"
                        style={FONT}
                      >
                        Open Pearl in Google Chat
                      </a>
                    ) : null}
                    {googleChatLinkCommand ? (
                      <Button
                        type="button"
                        onClick={copyGoogleChatLinkCommand}
                        disabled={googleChatLinkBusy}
                        className="h-9 bg-gray-700 px-3 text-sm text-gray-100 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400"
                        style={FONT}
                      >
                        {googleChatCommandCopied ? 'Copied' : 'Copy command'}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      onClick={refreshGoogleChatLinkStatus}
                      disabled={googleChatLinkBusy}
                      className="h-9 bg-gray-700 px-3 text-sm text-gray-100 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400"
                      style={FONT}
                    >
                      I sent it
                    </Button>
                  </div>
                </div>
              ) : null}

              {googleChatFlash ? (
                <p className={`text-xs ${googleChatFlash.kind === 'success' ? 'text-green-400' : 'text-red-400'}`} style={FONT}>
                  {googleChatFlash.message}
                </p>
              ) : null}
              {googleChatLinkError ? <p className="text-xs text-red-400" style={FONT}>{googleChatLinkError}</p> : null}
            </div>
          </SectionShell>
        )}
      </CardContent>
    </Card>
  );
}
