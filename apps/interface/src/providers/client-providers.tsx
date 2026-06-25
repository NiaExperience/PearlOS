"use client";

import { isFeatureEnabled } from '@nia/features';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';
import { LayoutModeProvider } from '@interface/contexts/layout-mode-context';
import { UIProvider } from '@interface/contexts/ui-context';
import { VoiceSessionProvider } from '@interface/contexts/voice-session-context';
import { DailyCallStateProvider } from '@interface/features/DailyCall/state/store';
import { ErrorBoundary } from '@interface/components/ErrorBoundary';
import { SoundtrackProvider, SoundtrackToggleButton } from '@interface/features/Soundtrack';
import { setClientLogContext } from '@interface/lib/client-logger';
import { installGlobalErrorReporter } from '@interface/lib/error-reporter';
import { useLayoutModeSwitchListener } from '@interface/hooks/useLayoutModeSwitchListener';
import { useGatewaySocket } from '@interface/features/DailyCall/hooks/useGatewaySocket';
import { useDailyCallState } from '@interface/features/DailyCall/state/store';
import { ConsoleNoiseFilter } from '@interface/providers/console-noise-filter';
import { PostHogProvider } from '@interface/providers/posthog-provider';
import { AssistantSoundEffects } from '@interface/components/assistant-sound-effects';
import { PersonalFeaturePackageHydrator } from '@interface/components/PersonalFeaturePackageHydrator';
import { getClientLogger } from '@interface/lib/client-logger';

const providersLog = getClientLogger('[client_providers]');
const AVATAR_TRACE_VERSION = 'avatar-trace-2026-03-02-02';

function LogContextProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();

  useEffect(() => {
    installGlobalErrorReporter();
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    const sessionUser = (data?.user as Record<string, unknown>) || {};
    const sessionId = (data as Record<string, unknown> | null | undefined)?.sessionId as string | undefined;
    const userScopedSessionId = (sessionUser as Record<string, unknown>).sessionId as string | undefined;

    const currentUserId = ((sessionUser as Record<string, unknown>).id as string | null | undefined) ?? null;
    setClientLogContext({
      sessionId: sessionId || userScopedSessionId || null,
      userId: currentUserId,
      userName: ((sessionUser as Record<string, unknown>).name as string | null | undefined) ?? null,
    });
    if (typeof window !== 'undefined') {
      try {
        if (currentUserId) window.sessionStorage.setItem('sessionUserId', currentUserId);
        else window.sessionStorage.removeItem('sessionUserId');
      } catch {
        // ignore private-mode storage failures
      }
    }
  }, [data, status]);

  return <>{children}</>;
}

/** Derive a room name from a Daily room URL (e.g. "https://xxx.daily.co/pearl-default" → "pearl-default"). */
function extractRoomName(roomUrl?: string): string | undefined {
  if (!roomUrl) return undefined;
  try {
    const url = new URL(roomUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || undefined;
  } catch {
    return undefined;
  }
}

/** Activates the layout mode switch listener so voice commands can toggle layout. */
function LayoutModeSwitchBridge() {
  useLayoutModeSwitchListener();
  return null;
}

/** Activates the gateway WebSocket so nia.events arrive even without Daily. */
function GatewaySocketBridge() {
  const { data: session, status } = useSession();
  const { roomUrl, joined } = useDailyCallState();
  const sessionUser = (session?.user as Record<string, unknown> | null | undefined) || {};
  const sessionRecord = session as unknown as Record<string, unknown> | null | undefined;
  const userId = typeof sessionUser.id === 'string' ? sessionUser.id : null;
  const authSessionId =
    typeof sessionRecord?.sessionId === 'string'
      ? sessionRecord.sessionId
      : typeof sessionUser.sessionId === 'string'
        ? sessionUser.sessionId
        : undefined;
  const dailySessionId = joined ? extractRoomName(roomUrl) : undefined;
  const sessionId = dailySessionId || authSessionId || userId || undefined;
  useGatewaySocket({ sessionId: status === 'loading' ? undefined : sessionId, userId });
  return null;
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const soundtrackEnabled = isFeatureEnabled('soundtrack');
  const terminalOnlyRoute = pathname === '/terminal' || Boolean(pathname?.endsWith('/terminal'));

  useEffect(() => {
    providersLog.info('ClientProviders mounted', {
      source: 'client_providers',
      avatarTraceVersion: AVATAR_TRACE_VERSION,
      soundtrackEnabled,
      floatingPearlMounted: false,
      assistantSoundEffectsMounted: true,
    });
    if (typeof window !== 'undefined') {
      (window as unknown as { __avatarTraceVersion?: string }).__avatarTraceVersion = AVATAR_TRACE_VERSION;
      console.info('[AVATAR_TRACE_VERSION]', AVATAR_TRACE_VERSION);
      console.info('[AVATAR_TRACE_COMPONENTS]', {
        floatingPearlMounted: false,
        assistantSoundEffectsMounted: true,
      });
    }
  }, [soundtrackEnabled]);

  if (terminalOnlyRoute) {
    return (
      <LogContextProvider>
        <ConsoleNoiseFilter />
        {children}
      </LogContextProvider>
    );
  }

  return (
    <LogContextProvider>
      <PostHogProvider>
        <UIProvider>
          <LayoutModeProvider>
            <DesktopModeProvider initialMode={DesktopMode.HOME}>
              <DailyCallStateProvider>
                <VoiceSessionProvider>
                  {/* Suppress known-benign console noise globally in the client */}
                  <GatewaySocketBridge />
                  <LayoutModeSwitchBridge />
                  <PersonalFeaturePackageHydrator />
                  <ConsoleNoiseFilter />
                  <AssistantSoundEffects />
                  {soundtrackEnabled ? (
                    <ErrorBoundary name="Soundtrack" silent>
                      <SoundtrackProvider>
                        {children}
                      </SoundtrackProvider>
                    </ErrorBoundary>
                  ) : (
                    children
                  )}
                </VoiceSessionProvider>
              </DailyCallStateProvider>
            </DesktopModeProvider>
          </LayoutModeProvider>
        </UIProvider>
      </PostHogProvider>
    </LogContextProvider>
  );
}
