/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useState } from 'react';

import { SocialConnectionsPanel } from '@interface/components/settings-panels/SocialConnectionsPanel';
import { LaunchModePanel } from '@interface/components/settings-panels/LaunchModePanel';
import { AudioPreferencesPanel } from '@interface/components/settings-panels/AudioPreferencesPanel';
import { ModelSettingsPanel } from '@interface/components/settings-panels/ModelSettingsPanel';
import { ChannelModelsPanel } from '@interface/components/settings-panels/ChannelModelsPanel';
import { ProfilePanel } from '@interface/components/settings-panels/ProfilePanel';
import { PearlOSCodeResetPanel } from '@interface/components/settings-panels/PearlOSCodeResetPanel';
import { Button } from '@interface/components/ui/button';
import { UserProfileProvider } from '@interface/contexts/user-profile-context';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { BUILD_STAMP } from '@interface/build-stamp';

import '../../features/Notes/styles/notes.css';

interface BuildInfo {
  buildId: string;
  commitSha: string;
  buildDate: string;
  packageVersion: string;
  buildName: string;
}

const DEFAULT_BUILD_INFO: BuildInfo = {
  buildId: BUILD_STAMP.commitSha,
  commitSha: BUILD_STAMP.commitSha,
  buildDate: BUILD_STAMP.buildTime.slice(0, 10),
  packageVersion: 'v2026.04.28',
  buildName: `PearlOS ${BUILD_STAMP.codename}`
};

export type PanelKey = 'connections' | 'model-config' | 'channel-models' | 'launch-mode' | 'audio-preferences' | 'profile' | 'recovery' | 'contact' | null;

const URL_PANEL_KEYS: readonly Exclude<PanelKey, null>[] = [
  'connections',
  'model-config',
  'channel-models',
  'launch-mode',
  'audio-preferences',
  'profile',
  'recovery',
  'contact',
];

/** Valid values for `?panel=` on `/settings` or `?settingsPanel=` on `/{assistant}` (e.g. `connections`). */
export function parseSettingsPanelUrlParam(raw: string | null): PanelKey {
  if (!raw) return null;
  const key = raw as Exclude<PanelKey, null>;
  return URL_PANEL_KEYS.includes(key) ? key : null;
}

interface Props {
  initialOpenPanel?: PanelKey;
  tenantId?: string;
  onOpenPanelChange?: (panel: PanelKey) => void;
}

export default function SettingsPanels({ initialOpenPanel = null, tenantId, onOpenPanelChange }: Props) {
  const [openPanel, setOpenPanel] = useState<PanelKey>(initialOpenPanel ?? 'connections');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (initialOpenPanel != null) {
      setOpenPanel(initialOpenPanel);
    }
  }, [initialOpenPanel]);
  const buildInfo = DEFAULT_BUILD_INFO;

  const [contactPressed, setContactPressed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Track viewport for mobile/desktop layout — only after hydration to avoid SSR mismatch
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 768);
    update();
    setHydrated(true);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    onOpenPanelChange?.(openPanel);
  }, [openPanel, onOpenPanelChange]);

  const navItems = [
    /* Hidden from settings menu — panel switch cases below unchanged
    { key: 'model-config', label: '🧠 Pearl Mind', icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="h-5 w-5" style={{ imageRendering: 'pixelated' }}>
        <path d="M10 2c-1.5 0-2.5 1-3 2-1.5.5-2.5 2-2.5 3.5 0 1 .5 2 1.5 2.5-.5.5-1 1.5-1 2.5 0 1.5 1 2.5 2.5 3 .5 1 1.5 1.5 2.5 1.5s2-.5 2.5-1.5c1.5-.5 2.5-1.5 2.5-3 0-1-.5-2-1-2.5 1-.5 1.5-1.5 1.5-2.5 0-1.5-1-3-2.5-3.5-.5-1-1.5-2-3-2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M10 4v12M6 7h8M6 10h8M6 13h8" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
      </svg>
    ) },
    { key: 'channel-models', label: '📡 Channel Models', icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path d="M10 2v4M10 14v4M2 10h4M14 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="10" cy="2" r="1.5" fill="currentColor" opacity="0.6" />
        <circle cx="10" cy="18" r="1.5" fill="currentColor" opacity="0.6" />
        <circle cx="2" cy="10" r="1.5" fill="currentColor" opacity="0.6" />
        <circle cx="18" cy="10" r="1.5" fill="currentColor" opacity="0.6" />
      </svg>
    ) },
    */
    { key: 'connections', label: 'Connections', icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="h-5 w-5" style={{ imageRendering: 'pixelated' }}>
        <path d="M3 10h4m6 0h4M10 3v4m0 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="3" cy="10" r="1.5" fill="currentColor" />
        <circle cx="17" cy="10" r="1.5" fill="currentColor" />
        <circle cx="10" cy="3" r="1.5" fill="currentColor" />
        <circle cx="10" cy="17" r="1.5" fill="currentColor" />
      </svg>
    ) },
    { key: 'profile', label: 'Profile', icon: <img src="/ProfileIco.png" alt="Profile" className="h-5 w-5" style={{ imageRendering: 'pixelated' }} /> },
    { key: 'launch-mode', label: 'Launch Mode', icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M8 8l4 2-4 2V8z" fill="currentColor" />
      </svg>
    ) },
    { key: 'audio-preferences', label: 'Audio', icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path d="M4 7v6h3l4 3V4L7 7H4z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        <path d="M14 6c1.5 1 1.5 3 0 4M16 4c3 2 3 6 0 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    ) },
    { key: 'recovery', label: 'Recovery', icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path d="M5 5v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 9A5 5 0 1 0 7 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10 7v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ) },
    /* { key: 'contact', label: 'Contact Us', icon: <img src="/EmailIcon.png" alt="Email" className="h-4 w-5" style={{ imageRendering: 'pixelated' }} /> }, */
  ];

  const renderPanel = () => {
    switch (openPanel) {
      case 'connections':
        return <SocialConnectionsPanel />;

      case 'model-config':
        return <ModelSettingsPanel />;

      case 'channel-models':
        return <ChannelModelsPanel />;

      case 'launch-mode':
        return <LaunchModePanel />;

      case 'audio-preferences':
        return <AudioPreferencesPanel />;

      case 'profile':
        return <ProfilePanel tenantId={tenantId} buildName={buildInfo.buildName} commitSha={buildInfo.commitSha} />;

      case 'recovery':
        return <PearlOSCodeResetPanel />;

      case 'contact':
        return (
          <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-white" style={{ fontFamily: 'Gohufont, monospace' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/EmailIcon.png"
                  alt="Email"
                  className="shrink-0"
                  style={{ imageRendering: 'pixelated', width: '41px', height: '29px' }}
                />
                Contact Us
              </CardTitle>
              <CardDescription className="text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                Have a question or feedback? Email us at{' '}
                <span className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>dev@niaxp.com</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-4" style={{ fontFamily: 'Gohufont, monospace' }}>
              <Button
                onClick={() => {
                  window.location.href = 'mailto:dev@niaxp.com';
                }}
                onMouseDown={() => setContactPressed(true)}
                onMouseUp={() => setContactPressed(false)}
                onMouseLeave={() => setContactPressed(false)}
                className="flex items-center justify-center p-0 font-semibold text-white"
                style={{
                  width: '144px',
                  height: '72px',
                  backgroundImage: `url(${contactPressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  imageRendering: 'pixelated',
                  border: '0',
                  boxShadow: 'none',
                  fontFamily: 'Gohufont, monospace',
                }}
              >
                Email Us
              </Button>
            </CardContent>
          </Card>
        );

      default:
        return (
          <div className="flex h-[300px] items-center justify-center text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
            Select a section from the sidebar to view settings
          </div>
        );
    }
  };

  const renderProfileBackedPanel = () => (
    <UserProfileProvider tenantId={tenantId}>
      {renderPanel()}
    </UserProfileProvider>
  );

  // Before hydration, render a minimal loading skeleton that matches
  // regardless of viewport width to prevent SSR hydration mismatch on iOS
  if (!hydrated) {
    return (
      <div className="flex gap-6" suppressHydrationWarning>
        <div className="flex-1" />
      </div>
    );
  }

  if (isMobile) {
    // Mobile: full-width menu on top, content below
    return (
      <div className="flex flex-col gap-3 w-full min-w-0">
        <Card className="border-gray-700 bg-gray-800" style={{ fontFamily: 'Gohufont, monospace' }}>
          <CardContent className="p-2">
            <div className="grid grid-cols-2 gap-1.5">
              {navItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => setOpenPanel(openPanel === item.key ? null : (item.key as PanelKey))}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors min-w-0
                    ${
                      openPanel === item.key
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  style={{ fontFamily: 'Gohufont, monospace' }}
                >
                  <span className="shrink-0 text-sm">{item.icon}</span>
                  <span className="text-xs truncate" style={{ fontFamily: 'Gohufont, monospace' }}>{item.label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="w-full min-w-0 overflow-x-hidden">
          <div className="mb-3 px-3 py-2 rounded-md border border-yellow-400/40 bg-yellow-400/10 text-yellow-200 text-xs" style={{ fontFamily: 'Gohufont, monospace' }}>
            ✨ {buildInfo.buildName} · {buildInfo.commitSha}
          </div>
          {renderProfileBackedPanel()}
        </div>
      </div>
    );
  }

  // Desktop: sidebar + content
  return (
    <div className="flex flex-col gap-3 overflow-visible">
    <div className="px-3 py-2 rounded-md border border-yellow-400/40 bg-yellow-400/10 text-yellow-200 text-sm" style={{ fontFamily: 'Gohufont, monospace' }}>
      ✨ {buildInfo.buildName} — build {buildInfo.commitSha} · {buildInfo.buildDate}
    </div>
    <div className="flex gap-6 overflow-visible">
      {/* Navigation Sidebar */}
      <Card className={`h-fit w-64 flex-shrink-0 border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
        <CardContent className="p-3">
          <div className="space-y-1">
            {navItems.map(item => (
              <button
                key={item.key}
                onClick={() => setOpenPanel(openPanel === item.key ? null : (item.key as PanelKey))}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors
                  ${
                    openPanel === item.key
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                style={{ fontFamily: 'Gohufont, monospace' }}
              >
                {item.icon}
                <span style={{ fontFamily: 'Gohufont, monospace' }}>{item.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Content Area */}
      <div className="flex-1 overflow-visible">{renderProfileBackedPanel()}</div>
    </div>
    </div>
  );
}

export { SettingsPanels };
