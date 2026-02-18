'use client';

import { X } from 'lucide-react';

import SettingsPanels from '@interface/components/settings-panels/SettingsPanels';
import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@interface/components/ui/card';
import '../features/Notes/styles/notes.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId?: string;
}

export function SettingsModal({ isOpen, onClose, tenantId }: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[900] flex items-start justify-center overflow-y-auto p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-[950] my-8 w-full max-w-4xl">
        <Card className="flex flex-col border-gray-700 bg-gray-900 shadow-2xl" style={{ fontFamily: 'Gohufont, monospace' }}>
          {/* Header */}
          <CardHeader className="flex flex-shrink-0 flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-center gap-3">
              {/* Custom Settings Icon */}
              <img
                src="/UsersettingIcon.png"
                alt="Settings"
                className="h-10 w-10"
                style={{ imageRendering: 'pixelated' }}
              />
              <CardTitle className="text-2xl text-white" style={{ fontFamily: 'Gohufont, monospace', fontWeight: 'normal', letterSpacing: '-0.5px' }}>Settings</CardTitle>
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
          <CardContent className="space-y-6">
            <SettingsPanels initialOpenPanel="profile" tenantId={tenantId} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
