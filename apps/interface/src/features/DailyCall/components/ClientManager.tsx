/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import type { PersonalityVoiceConfig } from '@nia/prism';
import React from 'react';

// Relocated from apps/interface/src/components/DailyCallClientManager.tsx (feature branch)
import InitializeDesktopMode from '@interface/components/InitializeDesktopMode';
import AssistantWrapper from '@interface/components/assistant-canvas';
import BrowserWindow from '@interface/components/browser-window';
import DesktopBackgroundSwitcher from '@interface/components/desktop-background-switcher';
import { Stage } from '@interface/features/Stage';
import ChatModeDesktop from '@interface/features/ChatMode/components/ChatModeDesktop';
import PearlWelcomeDialog from '@interface/components/pearl-welcome-dialog';
import { ProfileDropdown } from '@interface/components/profile-dropdown';
import { UserProfileProvider } from '@interface/contexts/user-profile-context';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { getClientLogger } from '@interface/lib/client-logger';
import type { VoiceParametersInput } from '@interface/lib/voice/kokoro';

import { DailyCallStateProvider } from '../state/store';
import { WsEventBridgeManager } from './WsEventBridgeManager';

type VoiceParameters = VoiceParametersInput & {
  maxCallDuration?: number;
  participantLeftTimeout?: number;
  participantAbsentTimeout?: number;
  enableRecording?: boolean;
  enableTranscription?: boolean;
  applyGreenscreen?: boolean;
};

type Props = {
  assistantName: string;
  tenantId: string;
  isAdmin: boolean;
  roomUrl: string;
  seatrade: boolean;
  assistantFirstName: string;
  assistantFirstMessage: string;
  themeData: any;
  voiceId: string;
  voiceProvider?: string;
  osPersonalityId?: string; // OS personality for voice-only calls
  persona: string;
  voiceParameters?: VoiceParameters;
  supportedFeatures: string[];
  startFullScreen: boolean;
  skipWelcomeOverlay?: boolean;
  // Assistant default desktop mode (e.g., 'home' | 'work' | 'creative' | 'gaming' | 'focus' | 'relaxation')
  initialDesktopMode?: string;
  allowedPersonalities?: Record<string, PersonalityVoiceConfig>; // Map of personality ID -> personality config
  modePersonalityVoiceConfig?: Record<string, any>;
  dailyCallPersonalityVoiceConfig?: Record<string, any>;
  sessionOverride?: Record<string, any>;
  resourceId?: string;
  resourceType?: string;
};

export default function ClientManager(props: Props) {
  const { assistantName, seatrade, assistantFirstName, assistantFirstMessage, themeData = null, supportedFeatures, startFullScreen, skipWelcomeOverlay, voiceId, voiceProvider, osPersonalityId, persona, voiceParameters, initialDesktopMode, modePersonalityVoiceConfig, dailyCallPersonalityVoiceConfig, allowedPersonalities, tenantId, isAdmin, roomUrl, sessionOverride, resourceId, resourceType } = props;
  const log = React.useMemo(() => getClientLogger('[daily_call]'), []);
  const dailyCallConfigKeys = React.useMemo(() => Object.keys(dailyCallPersonalityVoiceConfig || {}), [dailyCallPersonalityVoiceConfig]);
  
  // Debug props
  React.useEffect(() => {
    log.info('client manager props', {
      assistantName,
      themeDataPresent: !!themeData,
      modePersonalityVoiceConfigPresent: !!modePersonalityVoiceConfig,
      dailyCallPersonalityVoiceConfigPresent: !!dailyCallPersonalityVoiceConfig,
      dailyCallConfigKeys,
      dailyCallDefaultPersona: dailyCallPersonalityVoiceConfig?.default?.personaName,
      dailyCallDefaultVoiceId: dailyCallPersonalityVoiceConfig?.default?.voice?.voiceId,
    });
  }, [assistantName, log, themeData, modePersonalityVoiceConfig, dailyCallPersonalityVoiceConfig, dailyCallConfigKeys]);

  React.useEffect(() => {
    // Auto-open DailyCall when arriving via a share link. This relies on the
    // share redemption client storing the room URL and intent in sessionStorage.
    try {
      const sharedAssistant = sessionStorage.getItem('dailySharedAssistant');
      const sharedRoomUrl = sessionStorage.getItem('dailySharedRoomUrl');
      const intent = sessionStorage.getItem('dailySharedIntent');
      if (sharedAssistant === assistantName && sharedRoomUrl && intent) {
        requestWindowOpen({ viewType: 'dailyCall', source: 'dailyCall:share-link' });
        sessionStorage.removeItem('dailySharedRoomUrl');
        sessionStorage.removeItem('dailySharedAssistant');
        sessionStorage.removeItem('dailySharedIntent');
        sessionStorage.removeItem('dailySharedMode');
      }
    } catch (_) {
      // ignore storage issues (private mode, etc.)
    }
  }, [assistantName]);

  // Auto-start gating: only render the embedded DailyCall section if explicit env var is present.
  // If NEXT_PUBLIC_AUTO_START_DAILY_CALL is undefined or empty, user must launch via desktop icon.

  const autoStartDailyCall = process.env.NEXT_PUBLIC_AUTO_START_DAILY_CALL === 'true';
  // On mount, if auto-start is enabled, open DailyCall via the central BrowserWindow
  // event pathway to ensure only one instance is ever mounted.
  React.useEffect(() => {
    if (!autoStartDailyCall) return;
    const firedRef: any = (window as any);
    if (firedRef.__dailyCallAutostartFired) return;
    try {
      // Defer to next tick to let BrowserWindow mount its listeners first
      setTimeout(() => {
        try {
          requestWindowOpen({ viewType: 'dailyCall', source: 'dailyCall:autoStart' });
        } catch (_) {
          // no-op
        }
      }, 0);
      firedRef.__dailyCallAutostartFired = true;
    } catch (_) {
      // no-op
    }
  }, [autoStartDailyCall]);

  return (
    <UserProfileProvider tenantId={tenantId}>
      {!skipWelcomeOverlay && <PearlWelcomeDialog />}
      <DailyCallStateProvider>
        {/* WebSocket event bridge: auto-connects when no Daily call is active */}
        <WsEventBridgeManager />
        {/* DesktopModeProvider is already provided by ClientProviders at the root level.
          Do NOT re-provide it here as it creates a shadowed context that causes
          VoiceSessionContext to read the wrong currentMode value.
          
          VoiceSessionProvider is also at the root level.
          We should NOT re-provide any of these contexts here.
          
          InitializeDesktopMode dispatches a window event to set the mode in the
          root DesktopModeProvider, which DesktopBackgroundSwitcher listens to.
        */}
        {/* === Next-Gen UI: The Stage replaces DesktopBackgroundSwitcher === */}
        <Stage />
        {/* WORK desktop background + icons — visible when chat mode is active */}
        <ChatModeDesktop
          supportedFeatures={supportedFeatures}
          assistantName={assistantName}
          tenantId={tenantId}
          isAdmin={isAdmin}
        />
        {/* Old desktop kept for reference — not rendered:
        <DesktopBackgroundSwitcher
          supportedFeatures={supportedFeatures}
          modePersonalityVoiceConfig={modePersonalityVoiceConfig}
          assistantName={assistantName}
          tenantId={tenantId}
          isAdmin={isAdmin}
          initialResourceId={resourceId}
          initialResourceType={resourceType}
        />
        */}
        {/* Initialize desktop mode after switcher so listener is mounted */}
        <InitializeDesktopMode mode={(initialDesktopMode as any) || 'work'} />
        <ProfileDropdown tenantId={tenantId} />
        {seatrade ? (
          <div
            className={`absolute left-[16px] top-[16px] ${assistantName === 'seatrade-jdx' ? 'w-[120px]' : 'w-[200px]'}`}
          >
            {assistantName === 'seatrade-jdx' ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/Seatrade_Logo_orange.svg" alt="Seatrade Logo" />
                <h3 className="uppercase my-2">Concierge AI</h3>
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/NiaLogo.png" alt="Nia Concierge AI" />
              </>
            )}
          </div>
        ) : (
          assistantName !== 'nia-ambassador' && (
            <div className="pointer-events-auto">
              <h1 className={'mb-2 text-center text-4xl'}>{assistantName}</h1>
              <p className={'max-w-2xl text-center text-lg text-gray-400'}>{assistantFirstMessage}</p>
            </div>
          )
        )}
        <AssistantWrapper
          assistantName={assistantName}
          themeData={themeData}
          voiceId={voiceId}
          voiceProvider={voiceProvider}
          personalityId={osPersonalityId}
          tenantId={tenantId}
          persona={persona}
          voiceParameters={voiceParameters}
          modePersonalityVoiceConfig={modePersonalityVoiceConfig}
          dailyCallPersonalityVoiceConfig={dailyCallPersonalityVoiceConfig}
          supportedFeatures={supportedFeatures}
          startFullScreen={startFullScreen}
          sessionOverride={sessionOverride}
        />
        <BrowserWindow
          assistantName={assistantName}
          tenantId={tenantId}
          isAdmin={isAdmin}
          voiceId={voiceId}
          voiceProvider={voiceProvider}
          personalityId={osPersonalityId}
          persona={persona}
          voiceParameters={voiceParameters}
          supportedFeatures={supportedFeatures}
          initialRoomUrl={roomUrl}
          modePersonalityVoiceConfig={modePersonalityVoiceConfig}
          dailyCallPersonalityVoiceConfig={dailyCallPersonalityVoiceConfig}
          sessionOverride={sessionOverride}
        />
      </DailyCallStateProvider>
    </UserProfileProvider>
  );
}
