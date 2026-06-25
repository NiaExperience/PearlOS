'use client';

import { useCallback, useEffect, useState } from 'react';
import { Home, Monitor } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { SettingsModal } from '@interface/components/settings-modal';
import {
  parseSettingsPanelUrlParam,
  type PanelKey,
} from '@interface/components/settings-panels/SettingsPanels';
import { SoundtrackNavButton } from '@interface/components/SoundtrackNavButton';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useUI } from '@interface/contexts/ui-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import {
  PEARL_SETTINGS_OPEN_EVENT,
  writeOnboardingStatus,
  type PearlSettingsOpenDetail,
} from '@interface/lib/webchat-onboarding';
import { DesktopMode, type DesktopModeSwitchResponse } from '@interface/types/desktop-modes';
import { NIA_EVENT_ONBOARDING_COMPLETE } from '@interface/features/DailyCall/events/niaEventRouter';

interface PersistentNavButtonsProps {
  tenantId?: string;
}

type SettingsNavPanel = Exclude<PanelKey, null>;

export function PersistentNavButtons({ tenantId }: PersistentNavButtonsProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialPanel, setSettingsInitialPanel] = useState<SettingsNavPanel>('connections');
  const [openAppSources, setOpenAppSources] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentMode, setMode } = useDesktopMode();
  const { wonderChromeMode, setIsChatMode } = useUI();
  const { data: session } = useResilientSession();

  const wonderHideLeftNav = wonderChromeMode === 'full';
  const hasOpenApp = Object.values(openAppSources).some((viewTypes) => viewTypes.length > 0);

  // True when on the home/default screen; false when in desktop (work/creative/quiet/etc.) mode
  const isHome = currentMode === DesktopMode.HOME;
  const userKey = session?.user?.id || session?.user?.email || null;

  useEffect(() => {
    const handleWindowsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; viewTypes?: string[] }>).detail;
      const source = detail?.source || 'legacy';
      const viewTypes = Array.isArray(detail?.viewTypes) ? detail.viewTypes : [];
      setOpenAppSources((prev) => ({ ...prev, [source]: viewTypes }));
    };

    window.addEventListener('pearlos:open-windows-changed', handleWindowsChanged);
    return () => window.removeEventListener('pearlos:open-windows-changed', handleWindowsChanged);
  }, []);

  useEffect(() => {
    const handleSettingsOpen = (event: Event) => {
      const detail = (event as CustomEvent<PearlSettingsOpenDetail>).detail;
      if (!detail?.panel) return;
      setSettingsInitialPanel(detail.panel);
      setIsSettingsOpen(true);
    };

    window.addEventListener(PEARL_SETTINGS_OPEN_EVENT, handleSettingsOpen);
    return () => window.removeEventListener(PEARL_SETTINGS_OPEN_EVENT, handleSettingsOpen);
  }, []);

  useEffect(() => {
    if (!userKey) return;
    const handleOnboardingComplete = () => {
      writeOnboardingStatus(userKey, 'done');
    };
    window.addEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingComplete);
    return () => window.removeEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingComplete);
  }, [userKey]);

  // Keep chat mode in sync with desktop mode so the work desktop overlay
  // (ChatModeDesktop) only renders when not on the home screen.
  useEffect(() => {
    setIsChatMode(!isHome);
  }, [isHome, setIsChatMode]);

  // Deep link: /{assistant}?settingsPanel=connections opens this modal (not the /settings full page).
  useEffect(() => {
    if (!searchParams || !pathname) return;
    const panel = parseSettingsPanelUrlParam(searchParams.get('settingsPanel'));
    if (!panel) return;

    setSettingsInitialPanel(panel);
    setIsSettingsOpen(true);

    const next = new URLSearchParams(searchParams.toString());
    next.delete('settingsPanel');
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  const dispatchModeSwitch = useCallback(
    (targetMode: DesktopMode, switchReason: string, message: string) => {
      const switchResponse: DesktopModeSwitchResponse = {
        success: true,
        mode: targetMode,
        message,
        userRequest: null,
        timestamp: new Date().toISOString(),
        action: 'SWITCH_DESKTOP_MODE',
        payload: {
          targetMode,
          previousMode: currentMode,
          switchReason,
        },
      };

      window.dispatchEvent(
        new CustomEvent<DesktopModeSwitchResponse>('desktopModeSwitch', {
          detail: switchResponse,
        })
      );

      setMode(targetMode);
    },
    [currentMode, setMode]
  );

  const handleDesktop = useCallback(() => {
    dispatchModeSwitch(DesktopMode.DESKTOP, 'user_click_desktop_button', 'Switching to desktop mode');
    // Enable chat mode so ChatModeDesktop renders the work desktop icons
    setIsChatMode(true);
  }, [dispatchModeSwitch, setIsChatMode]);

  const handleHome = useCallback(() => {
    dispatchModeSwitch(DesktopMode.HOME, 'user_click_home_button', 'Switching to home screen');
    // Disable chat mode so ChatModeDesktop unmounts and the Stage home background is visible
    setIsChatMode(false);
  }, [dispatchModeSwitch, setIsChatMode]);

  return (
    <>
      <div
        className="pointer-events-auto fixed left-3 top-3 z-[60] flex flex-row gap-2 transition-opacity duration-200"
        style={{
          opacity: wonderHideLeftNav || hasOpenApp ? 0 : 1,
          visibility: wonderHideLeftNav || hasOpenApp ? ('hidden' as const) : ('visible' as const),
          fontFamily: 'Gohufont, monospace',
        }}
      >
        {/* Home/Desktop toggle — shows Home icon in desktop mode, Monitor icon on home screen */}
        {isHome ? (
          <button
            onClick={handleDesktop}
            title="Desktop"
            className="pearl-nav-button flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-white/25 hover:bg-black/60 hover:text-white"
          >
            <Monitor size={16} />
          </button>
        ) : (
          <button
            onClick={handleHome}
            title="Home"
            aria-label="Go to Home"
            className="pearl-nav-button flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-white/25 hover:bg-black/60 hover:text-white"
          >
            <Home size={16} />
          </button>
        )}

        {/* Soundtrack button */}
        <SoundtrackNavButton />

      </div>

      {/* Profile button removed 2026-04-08 (Blair): reserve top-right for window close button.
          Profile access remains available via Settings modal → Profile panel. */}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        tenantId={tenantId}
        initialOpenPanel={settingsInitialPanel}
      />
    </>
  );
}
