'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

import SettingsPanels from '@interface/components/settings-panels/SettingsPanels';
import { Button } from '@interface/components/ui/button';
import { useResilientSession } from '@interface/hooks/use-resilient-session';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useResilientSession();
  
  // Try to get tenantId from search params first, then session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantId = searchParams.get('tenantId') || (session?.user as any)?.tenantId;

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-700 bg-gray-800">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="flex items-center gap-2 text-gray-300 hover:bg-gray-700 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <h1 className="flex items-center text-2xl font-semibold text-white">
              {/* Pixelated Settings Gear Icon */}
              <div
                className="mr-3 h-6 w-6"
                style={{
                  imageRendering: 'pixelated',
                  background: `
                  linear-gradient(45deg, #06b6d4 0%, #06b6d4 25%, transparent 25%, transparent 50%, #06b6d4 50%, #06b6d4 75%, transparent 75%, transparent 100%),
                  linear-gradient(45deg, #06b6d4 0%, #06b6d4 25%, transparent 25%, transparent 50%, #06b6d4 50%, #06b6d4 75%, transparent 75%, transparent 100%)
                `,
                  backgroundSize: '4px 4px, 4px 4px',
                  backgroundPosition: '0 0, 2px 2px',
                  maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='3'%3E%3C/circle%3E%3Cpath d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1.51-1V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'%3E%3C/path%3E%3C/svg%3E")`,
                  maskRepeat: 'no-repeat',
                  maskSize: 'contain',
                  maskPosition: 'center',
                }}
              />
              Settings
            </h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">
        <SettingsPanels initialOpenPanel={null} tenantId={tenantId} />
      </div>
    </div>
  );
}
