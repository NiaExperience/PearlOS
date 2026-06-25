'use client';

import { useEffect, useCallback, useState } from 'react';
import { X } from 'lucide-react';

import SettingsPanels from '@interface/components/settings-panels/SettingsPanels';
import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@interface/components/ui/card';
import '../features/Notes/styles/notes.css';

type SettingsInitialPanel = Parameters<typeof SettingsPanels>[0]['initialOpenPanel'];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId?: string;
  initialOpenPanel?: SettingsInitialPanel;
}

export function SettingsModal({ isOpen, onClose, tenantId, initialOpenPanel = 'connections' }: SettingsModalProps) {
  const [activePanel, setActivePanel] = useState<SettingsInitialPanel>(initialOpenPanel);

  useEffect(() => {
    if (isOpen) {
      setActivePanel(initialOpenPanel);
    }
  }, [isOpen, initialOpenPanel]);

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const isConnectionsPanel = activePanel === 'connections';
  const modalTitle = isConnectionsPanel ? 'Connections' : 'Settings';

  return (
    <div className="pointer-events-auto fixed inset-0 z-[650] flex items-start justify-center overflow-hidden p-1 sm:p-4">
      {/* Backdrop — fixed so it stays full-screen even when content scrolls */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal — scrolls independently on top of the fixed backdrop.
          svh (small viewport height) instead of vh: on mobile Safari/Chrome,
          100vh is the LARGE viewport that includes the URL/address bar area,
          so the modal extended past the visible viewport and clipped the
          bottom rows (Connection/Audio settings). svh is the smallest visible
          viewport, so the modal always fits inside the visible area. */}
      <div className="relative z-[700] my-2 sm:my-8 w-full max-w-4xl max-h-[calc(100svh-1rem)] sm:max-h-[calc(100svh-4rem)] flex flex-col">
        <Card className="pearl-settings-scope flex flex-col border-gray-700 bg-gray-900 shadow-2xl overflow-hidden" style={{ fontFamily: 'var(--pearl-ui-font, Gohufont, monospace)' }}>
          {/* Header */}
          <CardHeader className="flex flex-shrink-0 flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-center gap-3">
              {!isConnectionsPanel && (
                <img
                  src="/UsersettingIcon.png"
                  alt="Settings"
                  className="h-10 w-10"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
              <CardTitle className="text-2xl text-white" style={{ fontFamily: 'var(--pearl-ui-font, Gohufont, monospace)', fontWeight: 'normal', letterSpacing: '0' }}>{modalTitle}</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:bg-gray-800 hover:text-white"
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <SettingsPanels initialOpenPanel={initialOpenPanel} tenantId={tenantId} onOpenPanelChange={setActivePanel} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
