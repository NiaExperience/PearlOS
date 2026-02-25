'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

const LAUNCH_PREF_KEY = 'pearlos-launch-mode-preference';
const LAST_MODE_KEY = 'pearlos-last-desktop-mode';

type LaunchPref = 'auto' | 'home' | 'work';

const OPTIONS: { value: LaunchPref; label: string; desc: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', desc: 'Remember last screen used', icon: '🔄' },
  { value: 'home', label: 'Always Home', desc: 'Always launch into Home mode', icon: '🏠' },
  { value: 'work', label: 'Always Desktop', desc: 'Always launch into Desktop mode', icon: '💼' },
];

export function LaunchModePanel() {
  const [pref, setPref] = useState<LaunchPref>('auto');
  const [lastMode, setLastMode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LAUNCH_PREF_KEY);
    if (stored === 'auto' || stored === 'home' || stored === 'work') {
      setPref(stored);
    }
    setLastMode(localStorage.getItem(LAST_MODE_KEY));
  }, []);

  const handleChange = (val: LaunchPref) => {
    setPref(val);
    localStorage.setItem(LAUNCH_PREF_KEY, val);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card className="border-gray-700 bg-gray-800" style={FONT}>
      <CardHeader>
        <CardTitle className="text-white" style={FONT}>Launch Mode</CardTitle>
        <CardDescription className="text-gray-400" style={FONT}>
          Choose which screen PearlOS launches into on startup
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" style={FONT}>
        <div className="space-y-2">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleChange(opt.value)}
              className={`w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors border ${
                pref === opt.value
                  ? 'border-blue-500 bg-blue-900/30 text-white'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
              style={FONT}
            >
              <span className="text-xl">{opt.icon}</span>
              <div>
                <div className="font-medium" style={FONT}>{opt.label}</div>
                <div className="text-xs text-gray-500" style={FONT}>{opt.desc}</div>
              </div>
              {pref === opt.value && (
                <span className="ml-auto text-blue-400">✓</span>
              )}
            </button>
          ))}
        </div>

        {pref === 'auto' && lastMode && (
          <p className="text-xs text-gray-500" style={FONT}>
            Last used mode: <span className="text-gray-300">{lastMode}</span>
          </p>
        )}

        {saved && (
          <p className="text-xs text-green-400" style={FONT}>
            ✅ Preference saved — takes effect on next launch
          </p>
        )}
      </CardContent>
    </Card>
  );
}
