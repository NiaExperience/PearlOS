/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines-per-function */
/* eslint-disable complexity */

import { FeatureKey, isFeatureEnabled } from '@nia/features';
import { getAssistantLoginFeatureState } from '@nia/prism/core';
import { AssistantActions, AssistantThemeActions, TenantActions, PersonalityActions, UserProfileActions, GlobalSettingsActions, UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';
// Import TenantRole from testing/types which re-exports enums in published dist
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import * as React from 'react';

import { getAssistantConfig } from '@interface/actions/getAssistant';
import FeaturesInitializer from '@interface/components/FeaturesInitializer';
import InitializeDesktopMode from '@interface/components/InitializeDesktopMode';
import AssistantWrapper from '@interface/components/assistant-canvas';
// Import client component directly (Next.js App Router will split client bundle automatically).
// Removed dynamic(..., { ssr: false }) usage because it's not allowed in a Server Component.
import BrowserWindow from '@interface/components/browser-window';
import DesktopBackgroundSwitcher from '@interface/components/desktop-background-switcher';
import { ProfileDropdown } from '@interface/components/profile-dropdown';
import ChatMode from '@interface/features/ChatMode/components/ChatMode';
import FileDropZone from '@interface/components/FileDropZone';
import DailyCallClientManager from '@interface/features/DailyCall/components/ClientManager';
import { getDailyRoomUrl } from '@interface/features/DailyCall/lib/config';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { AssistantThemeProvider } from '@interface/theme/AssistantThemeContext';

// Check if we're in test mode
function isTestMode(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.CYPRESS === 'true' ||
    process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true' ||
    process.env.TEST_MODE === 'true'
  );
}

export default async function AssistantPage({ 
  params, 
  searchParams 
}: { 
  params: Promise<{ assistantId: string }>,
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const log = getLogger('AssistantPage');
  const headersList = await headers();
  const isTest = isTestMode() || headersList.get('x-test-mode') === 'true';

  let session = null;
  // Resolve assistant name early so we can construct a proper callback URL if we need to redirect
  const { assistantId: assistantName } = await params;
  const resolvedSearchParams = await searchParams;
  const shareSource = typeof resolvedSearchParams.source === 'string' ? resolvedSearchParams.source : undefined;
  // Welcome overlay disabled for now — will revisit in better form later
  const skipWelcomeOverlay = true;
  const sharedRoomUrl = typeof resolvedSearchParams.roomUrl === 'string'
    ? decodeURIComponent(resolvedSearchParams.roomUrl)
    : undefined;

  if (isTest) {
    log.info('Test mode: creating anonymous session for testing', { assistantName });
    // In test mode, create a mock anonymous session
    session = {
      user: {
        id: 'test-anonymous-user',
        name: 'Test Guest',
        email: null,
        image: null,
        is_anonymous: true,
        sessionId: 'test-session',
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
    };
  } else {
    session = await getSessionSafely(undefined, interfaceAuthOptions);

    if (!session || !session.user) {
      // Build callback to current assistant page, preserving original query params if present
      const path = `/${assistantName}`;
      const search = headersList.get('x-original-query') || '';
      const callbackUrl = `${path}${search ? `?${search}` : ''}`;
      const host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
      const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1');
      // Local dev: auto-create a guest session so `/pearlos` works as a fully working entry point.
      // The login page will only auto-guest if the assistant allows anonymous login.
      const autoGuest = isLocalHost && process.env.NODE_ENV !== 'production';
      log.warn('No session user found; redirecting to signin', { assistantName, callbackUrl, autoGuest });
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}${autoGuest ? '&autoguest=1' : ''}`);
    } else {
      log.info('Session found', {
        userId: session.user.id,
        isAnonymous: session.user.is_anonymous,
      });
      
      // Check deny list for existing sessions (prevents banned users from accessing via cached session)
      let userEmail = 'email' in session.user ? session.user.email : null;
      
      // If email not in session, fetch from user record
      if (!userEmail && session.user.id) {
        try {
          const userRecord = await UserActions.getUserById(session.user.id);
          userEmail = userRecord?.email || null;
        } catch (err) {
          log.warn('Failed to fetch user record for deny list check', { userId: session.user.id, error: err });
        }
      }
      
      if (userEmail) {
        const isDenied = await GlobalSettingsActions.isEmailDenied(userEmail);
        if (isDenied) {
          log.warn('Session access denied: email is in deny list', { email: userEmail, userId: session.user.id });
          redirect('/login?error=AccessDenied');
        }
      }
    }
  }

  const clientLanguage = headersList.get('x-client-language') || 'en'; // Default to 'en' if header not present

  const sessionId =
    (session as any)?.sessionId ||
    (session?.user && 'sessionId' in session.user ? (session.user as any).sessionId : null);

  const sessionUserName = session?.user && 'name' in session.user ? (session.user as any).name : null;

  // Set request-scoped log context once we have session + language basics
  setLogContext({
    sessionId: sessionId || null,
    userId: session?.user?.id || null,
    userName: sessionUserName,
    tag: 'AssistantPage',
  });

  // Fetch raw assistant record (for _id look-up)
  const assistantRecord = await AssistantActions.getAssistantBySubDomain(assistantName);
  if (!assistantRecord) {
    log.error('Could not find assistant', { assistantName });
    // Return 404 page early - don't continue processing
    return (
      <main className="relative flex min-h-screen flex-col items-center justify-center bg-red-500 p-4 text-white">
        <div>
          <h1 className="mb-2 text-center text-3xl uppercase">Assistant not found</h1>
          <p className="text-center text-gray-400">Could not find assistant: {assistantName}</p>
        </div>

        <footer className="absolute bottom-4 mt-4 w-full py-4 shadow-md">
          <p className="text-center text-gray-500">&copy; 2025 All Rights Reserved</p>
        </footer>
      </main>
    );
  } else if (!assistantRecord.subDomain) {
    log.warn('Assistant has no subDomain', {
      assistantId: assistantRecord._id?.toString(),
      assistantName: assistantRecord.name,
    });
  }
  
  const { guestAllowed } = getAssistantLoginFeatureState(
    assistantRecord as unknown as { allowAnonymousLogin?: boolean | null; supportedFeatures?: unknown },
  );
  if (!isTest) {
    // If anonymous sessions are not allowed and current user is anonymous, force re-auth
    if (!guestAllowed && session?.user?.is_anonymous) {
      // Redirect to login with callback to current assistant page, preserving query params
      // (we cannot use redirect() with a relative URL and must build full path manually)
      const path = `/${assistantName}`;
      const search = headersList.get('x-original-query') || '';
      const callbackUrl = `${path}${search ? `?${search}` : ''}`;
      log.warn('Assistant does not allow anonymous access; redirecting to login', {
        assistantName,
        userId: session?.user?.id,
      });
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}&noguest=1`);
    }
  }
  // Fetch theme using the assistant ID
  const theme = await AssistantThemeActions.getAssistantTheme(
    assistantRecord?._id?.toString() || '',
    (assistantRecord?.name as string) || ''
  );
  // Basic startup diagnostics (do not include secrets or PII)
  log.info('Theme loaded for assistant', {
    assistant: assistantRecord?.name || assistantName,
    themePresent: !!theme,
  });
  const defaultDesktopMode = ((assistantRecord as any)?.desktopMode || 'work') as string;
  log.info('Assistant default desktop mode', { defaultDesktopMode });

  let modePersonalityVoiceConfig = (assistantRecord as any).modePersonalityVoiceConfig;
  // Ensure it's a plain object (handle Map)
  if (modePersonalityVoiceConfig && typeof modePersonalityVoiceConfig.toObject === 'function') {
      modePersonalityVoiceConfig = modePersonalityVoiceConfig.toObject();
  } else if (modePersonalityVoiceConfig instanceof Map) {
      modePersonalityVoiceConfig = Object.fromEntries(modePersonalityVoiceConfig);
  }

    let dailyCallPersonalityVoiceConfig = (assistantRecord as any).dailyCallPersonalityVoiceConfig;
    if (dailyCallPersonalityVoiceConfig && typeof dailyCallPersonalityVoiceConfig.toObject === 'function') {
      dailyCallPersonalityVoiceConfig = dailyCallPersonalityVoiceConfig.toObject();
    } else if (dailyCallPersonalityVoiceConfig instanceof Map) {
      dailyCallPersonalityVoiceConfig = Object.fromEntries(dailyCallPersonalityVoiceConfig);
    }

    const dailyCallConfigKeys = dailyCallPersonalityVoiceConfig
      ? Object.keys(dailyCallPersonalityVoiceConfig)
      : [];
    const dailyCallDefault = dailyCallPersonalityVoiceConfig?.default;
    log.info('Assistant dailyCall config snapshot', {
      hasDailyCallConfig: !!dailyCallPersonalityVoiceConfig,
      dailyCallConfigKeys,
      dailyCallDefaultPersona: dailyCallDefault?.personaName,
      dailyCallDefaultVoiceId: dailyCallDefault?.voice?.voiceId,
      dailyCallDefaultVoiceProvider: dailyCallDefault?.voice?.provider,
    });

  // Get default config
  const defaultConfig = modePersonalityVoiceConfig?.default;
  const defaultVoice = defaultConfig?.voice || {};
  const legacyVoice = (assistantRecord as any).voice || {};

  // Compute OS vs Bot personality IDs (bot falls back to OS if not set)
  const osPersonalityIdRaw = defaultConfig?.personalityId || (assistantRecord as any).personalityId || '';

  // Resolve initial personality/voice based on default mode
  let effectivePersonalityId = osPersonalityIdRaw;
  let effectiveVoiceId = defaultVoice.voiceId || legacyVoice.voiceId || '';
  let effectiveVoiceProvider = defaultVoice.provider || legacyVoice.provider || '';
  
  const effectiveVoiceParameters = {
    speed: defaultVoice.speed ?? legacyVoice.speed,
    stability: defaultVoice.stability ?? legacyVoice.stability,
    similarityBoost: defaultVoice.similarityBoost ?? legacyVoice.similarityBoost,
    style: defaultVoice.style ?? legacyVoice.style,
    optimizeStreamingLatency: defaultVoice.optimizeStreamingLatency ?? legacyVoice.optimizeStreamingLatency,
    maxCallDuration: defaultVoice.maxCallDuration ?? legacyVoice.maxCallDuration,
    participantLeftTimeout: defaultVoice.participantLeftTimeout ?? legacyVoice.participantLeftTimeout,
    participantAbsentTimeout: defaultVoice.participantAbsentTimeout ?? legacyVoice.participantAbsentTimeout,
    enableRecording: defaultVoice.enableRecording ?? legacyVoice.enableRecording,
    enableTranscription: defaultVoice.enableTranscription ?? legacyVoice.enableTranscription,
    applyGreenscreen: defaultVoice.applyGreenscreen ?? legacyVoice.applyGreenscreen,
    language: defaultVoice.language ?? legacyVoice.language,
  };

  const persona = defaultConfig?.personaName || (assistantRecord as any).persona_name || 'pearl';

  // Prefer direct Prism query in server component to avoid SSR proxy/auth header issues
  const email = session?.user && 'email' in session.user && session.user.email ? session.user.email : undefined;
  const res = session.user.id ? await UserProfileActions.findByUser(session.user.id, email) : null;
  
  // Fetch recent session history if available
  let sessionHistory: Array<any> = [];
  if (session.user.id && res?.userProfile?.sessionHistory) {
    // Get last 20 entries
    sessionHistory = res.userProfile.sessionHistory.slice(0, 20);
  }
  
  // Prioritize profile first_name over session user.name
  let userName = '';
  let userNameSource = '';
  const profileFirstName = res?.userProfile?.first_name || '';
  if (profileFirstName) {
    userName = profileFirstName;
    userNameSource = 'userProfile.first_name';
  } else if ('name' in session.user && typeof session.user.name === 'string' && session.user.name) {
    userName = session.user.name;
    userNameSource = 'session.user.name';
  } else {
    userName = '';
    userNameSource = 'empty';
  }
  log.debug('Resolved userName for session', { userNameSource, hasUserName: !!userName });
  
  let userProfileMetadata: Record<string, unknown> = {};
  try {
    if (res) {
      userProfileMetadata = res.userProfile?.metadata as Record<string, unknown> || {};
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('Failed to load userProfile metadata; continuing with defaults', {
      error: msg,
      userId: session.user.id,
    });
  }

  // eslint-disable-next-line no-console
  // Convert metadata values to strings for prompt context
  const toStr = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    try {
      if (typeof val === 'object') return JSON.stringify(val);
    } catch {
      // ignore JSON stringify errors
    }
    return String(val);
  };
  const userProfileForPrompt: Record<string, string> = Object.fromEntries(
    Object.entries(userProfileMetadata).map(([k, v]) => [k, toStr(v)])
  );
  log.info('Calling getAssistant', {
    assistantName,
    clientLanguage,
    userNamePresent: !!userName,
    userProfileKeys: Object.keys(userProfileForPrompt || {}),
    sessionHistoryCount: sessionHistory.length,
  });
  
  // Pass full userProfile object to getAssistantConfig, not just metadata
  const fullUserProfile = res?.userProfile || {};
  
  const { supportedFeatures } = await getAssistantConfig(
    assistantName,
    clientLanguage,
    userName,
    fullUserProfile,
    sessionHistory
  );
  // Supported features are passed to clients via props; avoid noisy server logs

  // Determine if we should apply mode-specific personality override
  // If onboarding is enabled and NOT complete, we stick to the default OS personality
  const isOnboardingEnabled = isFeatureEnabled('onboarding', supportedFeatures);
  const isOnboardingComplete = !isOnboardingEnabled || !!(fullUserProfile as any).onboardingComplete;
  const shouldApplyModeOverride = isOnboardingComplete;

  if (shouldApplyModeOverride && modePersonalityVoiceConfig && modePersonalityVoiceConfig[defaultDesktopMode]) {
      const cfg = modePersonalityVoiceConfig[defaultDesktopMode];
      // Handle new nested voice structure
      const voice = cfg.voice || {};
      
      effectivePersonalityId = cfg.personalityId || effectivePersonalityId;
      effectiveVoiceId = voice.voiceId || cfg.voiceId || effectiveVoiceId;
      effectiveVoiceProvider = voice.provider || cfg.voiceProvider || effectiveVoiceProvider;
      
      // Merge parameters
      const overrideParams = {
          speed: voice.speed ?? cfg.voiceParameters?.speed,
          stability: voice.stability ?? cfg.voiceParameters?.stability,
          similarityBoost: voice.similarityBoost ?? cfg.voiceParameters?.similarityBoost,
          style: voice.style ?? cfg.voiceParameters?.style,
          optimizeStreamingLatency: voice.optimizeStreamingLatency ?? cfg.voiceParameters?.optimizeStreamingLatency,
      };
      
      // Only merge defined values
      Object.keys(overrideParams).forEach(key => {
          if ((overrideParams as any)[key] !== undefined) {
              (effectiveVoiceParameters as any)[key] = (overrideParams as any)[key];
          }
      });
  }

  // Fetch OS personality for validation/logging and UI usage
  // (Moved here to ensure we fetch the effective personality after potential mode override)
  const osPersonality = await PersonalityActions.getPersonalityById(effectivePersonalityId);
  if (!osPersonality) {
    log.error('Could not find OS personality', {
      effectivePersonalityId,
      assistantName,
    });
  }
  const osPersonalityId = osPersonality?._id?.toString() || '';

  // Construct sessionOverride if appletId or mode is present
  const resourceId = resolvedSearchParams.resourceId as string;
  const modeParam = resolvedSearchParams.mode as string;
  const lockedParam = resolvedSearchParams.locked === 'true';
  const contentType = resolvedSearchParams.contentType as string;
  
  let sessionOverride: Record<string, any> | undefined = undefined;

  if (resourceId || modeParam) {
      sessionOverride = {
          mode: modeParam || 'creative',
          locked: lockedParam || !!resourceId,
          resourceId: resourceId || undefined,
          contentType: contentType || undefined,
      };
      log.info('Session override active', { sessionOverride });
  }

  const seatrade =
    assistantName === 'seatrade' ||
    assistantName === 'paddytest' ||
    assistantName === 'seatrade-jdx';
  // Resolve admin based on tenant role (owner/admin allowed). Default false for anonymous.
  let isAdmin = false;
  try {
    const devBypass = process.env.NEXT_PUBLIC_INTERFACE_DEV_BYPASS_TENANT === 'true';
    if (devBypass) {
      // In local dev bypass mode, treat as admin for convenience
      isAdmin = true;
    } else if (!session?.user?.is_anonymous && assistantRecord?.tenantId) {
      isAdmin = await TenantActions.userHasAccess(
        session.user.id,
        assistantRecord.tenantId,
        UserTenantRoleBlock.TenantRole.ADMIN
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('Failed to resolve isAdmin; defaulting to false', { error: msg, userId: session?.user?.id });
    isAdmin = false;
  }

  // User should be part of the tenant
  if (!assistantRecord?.tenantId) {
    throw new Error(`Assistant ${assistantName} does not have a tenantId`);
  } else {
    // In test/CI mode or when using an anonymous session for testing, bypass tenant membership checks
    // Also bypass in local development for convenience (env NEXT_PUBLIC_INTERFACE_DEV_BYPASS_TENANT=true)
    const devBypass = process.env.NEXT_PUBLIC_INTERFACE_DEV_BYPASS_TENANT === 'true';
    if (!isTest && !session?.user?.is_anonymous && !devBypass) {
      let isUserInTenant = false;
      try {
        isUserInTenant = await TenantActions.userHasAccess(session.user.id, assistantRecord?.tenantId);
      } catch (err: any) {
        if (err.message === 'User not found') {
          log.warn('User not found in DB but has active session; clearing session and redirecting', {
            userId: session.user.id,
            assistantName,
          });
          // Redirect to the signout route which handles cookie clearing and redirection to login
          // We must preserve the assistant name in the callbackUrl so the login page knows which assistant to load
          const loginUrl = `/login?callbackUrl=${encodeURIComponent('/' + assistantName)}`;
          redirect(`/api/auth/signout?callbackUrl=${encodeURIComponent(loginUrl)}`);
        }
        throw err;
      }

      if (!isUserInTenant) {
        // Auto-add authenticated users (especially new Google OAuth users) to this tenant as MEMBER
        try {
          log.info('User not in tenant, auto-adding as MEMBER', { userId: session.user.id });
          await TenantActions.assignUserToTenant(
            session.user.id,
            assistantRecord.tenantId,
            UserTenantRoleBlock.TenantRole.MEMBER
          );
          log.info('Successfully added user to tenant as MEMBER', { userId: session.user.id });
        } catch (addError) {
          // If auto-add fails, throw the original error
          log.error('Failed to auto-add user to tenant', { error: addError, userId: session.user.id });
          throw new Error(`User ${userName} is not part of tenant`);
        }
      }
      // Admin check omitted here to reduce coupling; isAdmin remains false by default
    }
  }

  const startFullScreenValue = Boolean(assistantRecord?.startFullScreen);
  const dailyRoomUrl = sharedRoomUrl || await getDailyRoomUrl();
  if (sharedRoomUrl) {
    log.info('Using shared Daily room from query param', { assistantName });
  }

  // Extract allowedPersonalities config for personality selection feature
  // This is now a Record<string, PersonalityVoiceConfig> that contains full voice configuration per personality
  const allowedPersonalities = assistantRecord?.allowedPersonalities && 
    typeof assistantRecord.allowedPersonalities === 'object' && 
    !Array.isArray(assistantRecord.allowedPersonalities)
      ? assistantRecord.allowedPersonalities
      : undefined;

  const effectiveInitialMode = sessionOverride?.mode || (assistantRecord as any)?.desktopMode || 'work';

  return (
    <AssistantThemeProvider theme={theme}>
      <FeaturesInitializer features={supportedFeatures as FeatureKey[]}>
        <main
          className={
            'pointer-events-none relative flex h-dvh max-h-dvh flex-col items-center justify-center overflow-hidden p-4 text-white'
          }
          style={
            {
              // backgroundColor: theme?.theme_config?.colors?.background || '#000000',
            } as React.CSSProperties
          }
        >
          {/* Legacy vs. new experience branching continues below */}
          {/* Pass supportedFeatures to the client via props and also gate on the server with explicit list when possible */}
          {isFeatureEnabled('dailyCall', supportedFeatures) ? (
            // New DailyCall experience (mirrors legacy layout but encapsulated in feature module)
            <React.Fragment>
            <DailyCallClientManager
              isAdmin={isAdmin}
              tenantId={assistantRecord?.tenantId}
              assistantName={assistantName}
              persona={persona}
              // botPersonalityId={botPersonalityId}
              osPersonalityId={osPersonalityId}
              roomUrl={dailyRoomUrl}
              seatrade={seatrade}
              skipWelcomeOverlay={skipWelcomeOverlay}
              assistantFirstName={assistantRecord?.name}
              assistantFirstMessage={assistantRecord?.firstMessage || ''}
              themeData={theme}
              voiceId={effectiveVoiceId}
              voiceProvider={effectiveVoiceProvider}
              initialDesktopMode={effectiveInitialMode}
              allowedPersonalities={allowedPersonalities}
              modePersonalityVoiceConfig={modePersonalityVoiceConfig}
              dailyCallPersonalityVoiceConfig={dailyCallPersonalityVoiceConfig}
              voiceParameters={effectiveVoiceParameters}
              supportedFeatures={supportedFeatures}
              startFullScreen={startFullScreenValue}
              sessionOverride={sessionOverride}
              resourceId={resourceId}
              resourceType={contentType}
            />
            <div className="pointer-events-auto">
              <ChatMode />
            </div>
            <FileDropZone />
            </React.Fragment>
          ) : (
            // Existing (legacy) experience (unchanged)
            <>
              <DesktopBackgroundSwitcher
                supportedFeatures={supportedFeatures}
                initialMode={effectiveInitialMode}
                modePersonalityVoiceConfig={modePersonalityVoiceConfig}
                assistantName={assistantName}
                initialResourceId={resourceId}
                initialResourceType={contentType}
              />
              {/* Initialize desktop mode after switcher so listener is mounted */}
              <InitializeDesktopMode mode={effectiveInitialMode} />
              <div className="pointer-events-auto">
                <ProfileDropdown tenantId={assistantRecord?.tenantId} />
              </div>
              {seatrade && (
                <div
                  className={`pointer-events-auto absolute left-[16px] top-[16px] ${assistantName === 'seatrade-jdx' ? 'w-[120px]' : 'w-[200px]'}`}
                >
                  {assistantName === 'seatrade-jdx' ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/images/Seatrade_Logo_orange.svg" alt="Seatrade Logo" />
                      <h3 className="my-2 uppercase">Concierge AI</h3>
                    </>
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/images/NiaLogo.png" alt="Nia Concierge AI" />
                    </>
                  )}
                </div>
              )}
              {!seatrade && assistantName !== 'nia-ambassador' && (
                <div className="pointer-events-auto">
                  <h1 className={'mb-2 text-center text-4xl'}>{assistantRecord.name}</h1>
                  <p className={'max-w-2xl text-center text-lg text-gray-400'}>
                    {assistantRecord.firstMessage}
                  </p>
                </div>
              )}
              <div className="pointer-events-auto">
                <AssistantWrapper
                  assistantName={assistantName}
                  clientLanguage={clientLanguage}
                  themeData={theme}
                  supportedFeatures={supportedFeatures || []}
                  startFullScreen={startFullScreenValue}
                  personalityId={osPersonalityId}
                  tenantId={assistantRecord?.tenantId}
                  persona={persona}
                  voiceId={effectiveVoiceId}
                  voiceProvider={effectiveVoiceProvider}
                  allowedPersonalities={allowedPersonalities}
                  modePersonalityVoiceConfig={modePersonalityVoiceConfig}
                  voiceParameters={effectiveVoiceParameters}
                />
              </div>
              <div className="pointer-events-auto">
                <BrowserWindow
                  assistantName={assistantName}
                  voiceId={effectiveVoiceId}
                  voiceProvider={effectiveVoiceProvider}
                  isAdmin={isAdmin}
                  tenantId={assistantRecord.tenantId}
                  personalityId={osPersonalityId}
                  persona={(assistantRecord as any)?.persona_name || 'Pearl'}
                  supportedFeatures={supportedFeatures || []}
                  initialRoomUrl={dailyRoomUrl}
                  voiceParameters={effectiveVoiceParameters}
                  modePersonalityVoiceConfig={modePersonalityVoiceConfig}
                  dailyCallPersonalityVoiceConfig={dailyCallPersonalityVoiceConfig}
                />
              </div>
              <div className="pointer-events-auto">
                <ChatMode />
              </div>
              <FileDropZone />
            </>
          )}
        </main>
      </FeaturesInitializer>
    </AssistantThemeProvider>
  );
}
export const dynamic = "force-dynamic";
