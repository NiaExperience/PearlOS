'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { Switch } from '@interface/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@interface/components/ui/select';
import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import {
  DEFAULT_MUSIC_ENABLED,
  DEFAULT_VOICE_PROVIDER,
  getPearlOSPreferences,
  normalizeVoiceProvider,
  readMusicEnabledPreference,
  readLocalPreference,
  type VoiceProvider,
  VOICE_PROVIDER_KEY,
  writeLocalPreference,
  writeMusicEnabledPreference,
} from '@interface/lib/pearlos-user-preferences';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

const VOICE_OPTIONS: { value: VoiceProvider; label: string }[] = [
  { value: 'cartesia', label: 'Cartesia' },
  { value: 'pockettts', label: 'PocketTTS' },
];

export function AudioPreferencesPanel() {
  const profile = useUserProfileOptional();
  const { data: session } = useResilientSession();
  const userId = session?.user?.id ?? null;
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>(DEFAULT_VOICE_PROVIDER);
  const [musicEnabled, setMusicEnabled] = useState(DEFAULT_MUSIC_ENABLED);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile?.loading) return;

    const prefs = getPearlOSPreferences(profile?.privateMemory);
    const profileVoice = normalizeVoiceProvider(prefs.voiceProvider);
    const localVoice = normalizeVoiceProvider(readLocalPreference(VOICE_PROVIDER_KEY, userId));
    setVoiceProvider(profileVoice ?? localVoice ?? DEFAULT_VOICE_PROVIDER);

    setMusicEnabled(
      typeof prefs.musicEnabled === 'boolean'
        ? prefs.musicEnabled
        : readMusicEnabledPreference(userId)
    );
  }, [profile?.loading, profile?.privateMemory, userId]);

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleVoiceChange = (val: VoiceProvider) => {
    setVoiceProvider(val);
    writeLocalPreference(VOICE_PROVIDER_KEY, val, userId);
    profile?.updatePearlOSPreferences({ voiceProvider: val });
    flashSaved();
  };

  const handleMusicToggle = (val: boolean) => {
    setMusicEnabled(val);
    writeMusicEnabledPreference(val, userId);
    profile?.updatePearlOSPreferences({ musicEnabled: val });
    window.dispatchEvent(new CustomEvent('soundtrackControl', {
      detail: { action: val ? 'play' : 'stop', source: 'settings', persistPreference: true },
    }));
    flashSaved();
  };

  return (
    <Card className="border-gray-700 bg-gray-800" style={FONT}>
      <CardHeader>
        <CardTitle className="text-white" style={FONT}>Audio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5" style={FONT}>
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300" style={FONT}>
            Voice
          </label>
          <Select value={voiceProvider} onValueChange={(value) => handleVoiceChange(value as VoiceProvider)}>
            <SelectTrigger
              className="border-gray-700 bg-gray-900 text-gray-200"
              style={FONT}
              aria-label="Voice"
            >
              <SelectValue placeholder="Select voice" />
            </SelectTrigger>
            <SelectContent className="z-[900] border-gray-700 bg-gray-900 text-gray-200">
              {VOICE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between border-t border-gray-700 pt-4">
          <label className="text-sm font-medium text-gray-300" style={FONT}>Audio at start</label>
          <Switch checked={musicEnabled} onCheckedChange={handleMusicToggle} />
        </div>

        {saved && (
          <p className="text-xs text-green-400" style={FONT}>
            Preference saved
          </p>
        )}
      </CardContent>
    </Card>
  );
}
