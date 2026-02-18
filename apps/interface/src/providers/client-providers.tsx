"use client";

import { isFeatureEnabled } from '@nia/features';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';
import { UIProvider } from '@interface/contexts/ui-context';
import { VoiceSessionProvider } from '@interface/contexts/voice-session-context';
import { DailyCallStateProvider } from '@interface/features/DailyCall/state/store';
import { ErrorBoundary } from '@interface/components/ErrorBoundary';
import { SoundtrackProvider, SoundtrackToggleButton } from '@interface/features/Soundtrack';
import { setClientLogContext } from '@interface/lib/client-logger';
import { useGatewaySocket } from '@interface/features/DailyCall/hooks/useGatewaySocket';
import { useDailyCallState } from '@interface/features/DailyCall/state/store';
import { ConsoleNoiseFilter } from '@interface/providers/console-noise-filter';
import { PostHogProvider } from '@interface/providers/posthog-provider';

function LogContextProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();

  useEffect(() => {
    if (status === 'loading') return;
    const sessionUser = (data?.user as Record<string, unknown>) || {};
    const sessionId = (data as Record<string, unknown> | null | undefined)?.sessionId as string | undefined;
    const userScopedSessionId = (sessionUser as Record<string, unknown>).sessionId as string | undefined;

    setClientLogContext({
      sessionId: sessionId || userScopedSessionId || null,
      userId: (sessionUser as Record<string, unknown>).id as string | null ?? null,
      userName: (sessionUser as Record<string, unknown>).name as string | null ?? null,
    });
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

/** Activates the gateway WebSocket so nia.events arrive even without Daily. */
function GatewaySocketBridge() {
  const { roomUrl, joined } = useDailyCallState();
  const sessionId = joined ? extractRoomName(roomUrl) : undefined;
  useGatewaySocket({ sessionId });
  return null;
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  const soundtrackEnabled = isFeatureEnabled('soundtrack');

  return (
    <LogContextProvider>
      <PostHogProvider>
        <UIProvider>
          <DesktopModeProvider initialMode={DesktopMode.HOME}>
            <DailyCallStateProvider>
              <VoiceSessionProvider>
                {/* Suppress known-benign console noise globally in the client */}
                <GatewaySocketBridge />
                <ConsoleNoiseFilter />
                {soundtrackEnabled ? (
                  <ErrorBoundary name="Soundtrack" silent>
                    <SoundtrackProvider>
                      {children}
                      <SoundtrackToggleButton />
                    </SoundtrackProvider>
                  </ErrorBoundary>
                ) : (
                  children
                )}
              </VoiceSessionProvider>
            </DailyCallStateProvider>
          </DesktopModeProvider>
        </UIProvider>
      </PostHogProvider>
    </LogContextProvider>
  );
}
