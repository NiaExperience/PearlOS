'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@interface/components/ui/card';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';
import { useInterfaceCustomization } from '@interface/hooks/use-interface-customization';
import {
  INTERFACE_THEME_BACKGROUNDS,
  INTERFACE_THEME_OPTIONS,
  deleteCustomInterfaceTheme,
  generateCustomInterfaceTheme,
  resetInterfaceAssets,
  setInterfaceTheme,
  type InterfaceThemeId,
} from '@interface/lib/interface-customization';

const FONT = { fontFamily: 'var(--pearl-ui-font, Gohufont, monospace)' };

interface AppearancePanelProps {
  title?: string;
  description?: string;
}

function previewBackgroundImage(home: string, desktop: string): string {
  const clean = (value: string) => value.replace(/["\\\n\r]/g, '');
  return `linear-gradient(90deg, rgba(0,0,0,0.12), rgba(0,0,0,0.12)), url("${clean(home)}"), url("${clean(desktop)}")`;
}

export function AppearancePanel({
  title = 'Appearance',
  description = 'Theme, backgrounds, and desktop icons',
}: AppearancePanelProps = {}) {
  const customization = useInterfaceCustomization();
  const [customThemeOpen, setCustomThemeOpen] = useState(false);
  const [customThemePrompt, setCustomThemePrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const chooseTheme = (theme: InterfaceThemeId) => {
    setInterfaceTheme(theme);
    setMessage(null);
  };

  const createCustomTheme = async () => {
    const prompt = customThemePrompt.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const state = await generateCustomInterfaceTheme(prompt);
      const created = state.customThemes.find((theme) => theme.id === state.theme);
      setMessage(`${created?.label || 'Custom'} theme created and applied`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Theme generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-gray-700 bg-gray-800 pearl-themed-card" style={FONT}>
      <CardHeader>
        <CardTitle className="text-white" style={FONT}>{title}</CardTitle>
        <CardDescription className="text-gray-400" style={FONT}>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6" style={FONT}>
        <div className="space-y-3">
          <Label className="text-gray-300" style={FONT}>Theme</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(5,minmax(0,1fr))]">
            {INTERFACE_THEME_OPTIONS.map((option) => {
              const active = customization.theme === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={active ? 'default' : 'outline'}
                  className={
                    active
                      ? 'h-auto min-h-[96px] flex-col gap-2 bg-blue-600 p-2 text-white hover:bg-blue-500'
                      : 'h-auto min-h-[96px] flex-col gap-2 border-gray-600 bg-gray-900/60 p-2 text-gray-200 hover:bg-gray-700'
                  }
                  onClick={() => chooseTheme(option.value)}
                  style={FONT}
                >
                  <span
                    aria-hidden="true"
                    data-preview-home={INTERFACE_THEME_BACKGROUNDS[option.value].home}
                    data-preview-desktop={INTERFACE_THEME_BACKGROUNDS[option.value].desktop}
                    className="h-12 w-full overflow-hidden rounded border border-white/15"
                    style={{
                      backgroundImage: previewBackgroundImage(
                        INTERFACE_THEME_BACKGROUNDS[option.value].home,
                        INTERFACE_THEME_BACKGROUNDS[option.value].desktop,
                      ),
                      backgroundPosition: 'left center, left center, right center',
                      backgroundSize: '100% 100%, 55% 100%, 55% 100%',
                      backgroundRepeat: 'no-repeat',
                    }}
                  />
                  <span>{option.label}</span>
                </Button>
              );
            })}
            {customization.customThemes.map((theme) => {
              const active = customization.theme === theme.id;
              return (
                <div key={theme.id} className="flex min-w-0 gap-1">
                  <Button
                    type="button"
                    variant={active ? 'default' : 'outline'}
                    className={
                      active
                        ? 'h-auto min-h-[96px] min-w-0 flex-1 flex-col gap-2 bg-blue-600 p-2 text-white hover:bg-blue-500'
                        : 'h-auto min-h-[96px] min-w-0 flex-1 flex-col gap-2 border-gray-600 bg-gray-900/60 p-2 text-gray-200 hover:bg-gray-700'
                    }
                    onClick={() => chooseTheme(theme.id)}
                    style={FONT}
                    title={theme.prompt}
                  >
                    <span
                      aria-hidden="true"
                      data-preview-home={theme.backgrounds.home}
                      data-preview-desktop={theme.backgrounds.desktop}
                      className="h-12 w-full overflow-hidden rounded border border-white/15"
                      style={{
                        backgroundImage: previewBackgroundImage(theme.backgrounds.home, theme.backgrounds.desktop),
                        backgroundPosition: 'left center, left center, right center',
                        backgroundSize: '100% 100%, 55% 100%, 55% 100%',
                        backgroundRepeat: 'no-repeat',
                      }}
                    />
                    <span className="truncate">{theme.label}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Delete ${theme.label} theme`}
                    title={`Delete ${theme.label} theme`}
                    onClick={() => {
                      deleteCustomInterfaceTheme(theme.id);
                      setMessage(`${theme.label} theme deleted`);
                    }}
                    className="h-10 w-10 shrink-0 border-gray-600 bg-gray-900/60 p-0 text-gray-200 hover:bg-red-950/60 hover:text-red-100"
                    style={FONT}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              aria-label="Create custom theme"
              title="Create custom theme"
              onClick={() => {
                setCustomThemeOpen((open) => !open);
                setMessage(null);
              }}
              className="h-10 min-w-0 bg-emerald-600 px-0 text-white hover:bg-emerald-500"
              style={FONT}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {customThemeOpen && (
          <div className="space-y-3">
            <Label htmlFor="pearl-custom-theme-prompt" className="text-gray-300" style={FONT}>
              Custom Theme
            </Label>
            <div className="flex gap-2">
              <Input
                id="pearl-custom-theme-prompt"
                value={customThemePrompt}
                onChange={(event) => setCustomThemePrompt(event.target.value)}
                placeholder="scifi 80s"
                className="border-gray-700 bg-gray-900 text-white"
                style={FONT}
              />
              <Button
                type="button"
                onClick={createCustomTheme}
                disabled={!customThemePrompt.trim() || busy}
                className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
                style={FONT}
              >
                {busy ? 'Making' : 'Create'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-gray-700 pt-4">
          <span className="text-sm text-gray-400" style={FONT}>{message || 'Four base themes plus custom generated assets'}</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              resetInterfaceAssets();
              setMessage('Assets reset');
            }}
            className="border-gray-600 bg-gray-900/60 text-gray-200 hover:bg-gray-700"
            style={FONT}
          >
            Reset Assets
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
