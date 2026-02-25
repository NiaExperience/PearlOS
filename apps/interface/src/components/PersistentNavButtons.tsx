'use client';

import { useCallback, useState } from 'react';
import { Home, Monitor, Settings } from 'lucide-react';
import { SettingsModal } from '@interface/components/settings-modal';
import { SoundtrackNavButton } from '@interface/components/SoundtrackNavButton';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode, type DesktopModeSwitchResponse } from '@interface/types/desktop-modes';

interface PersistentNavButtonsProps {
  tenantId?: string;
}

export function PersistentNavButtons({ tenantId }: PersistentNavButtonsProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { currentMode, setMode } = useDesktopMode();

  // True when on the home/default screen; false when in desktop (work/creative/quiet/etc.) mode
  const isHome = currentMode === DesktopMode.HOME || currentMode === DesktopMode.DEFAULT;

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
    dispatchModeSwitch(DesktopMode.WORK, 'user_click_desktop_button', 'Switching to desktop mode');
  }, [dispatchModeSwitch]);

  const handleHome = useCallback(() => {
    dispatchModeSwitch(DesktopMode.HOME, 'user_click_home_button', 'Switching to home screen');
  }, [dispatchModeSwitch]);

  return (
    <>
      <div
        className="pointer-events-auto fixed left-3 top-3 z-[800] flex flex-row gap-2"
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        {/* Home/Desktop toggle — shows Home icon in desktop mode, Monitor icon on home screen */}
        {isHome ? (
          <button
            onClick={handleDesktop}
            title="Desktop"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-white/25 hover:bg-black/60 hover:text-white"
          >
            <Monitor size={16} />
          </button>
        ) : (
          <button
            onClick={handleHome}
            title="Home"
            aria-label="Go to Home"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-white/25 hover:bg-black/60 hover:text-white"
          >
            <Home size={16} />
          </button>
        )}

        {/* Soundtrack button */}
        <SoundtrackNavButton />

        {/* Settings button */}
        <button
          onClick={() => setIsSettingsOpen(true)}
          title="Settings"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-white/25 hover:bg-black/60 hover:text-white"
        >
          <Settings size={16} />
        </button>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        tenantId={tenantId}
      />
    </>
  );
}
