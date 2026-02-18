'use client';

import React, { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types — mirrors Prism sprite.block.ts bot config
// ---------------------------------------------------------------------------

type SpriteBotType = 'companion' | 'assistant' | 'game' | 'custom';

interface SpriteBehavior {
  id: string;
  trigger: string;
  action: string;
  enabled: boolean;
}

interface SpriteBotConfig {
  botType: SpriteBotType;
  tools: string[];
  systemPrompt: string;
  greeting: string;
  behaviors: SpriteBehavior[];
}

// ---------------------------------------------------------------------------
// Tool catalogue — grouped for the picker UI
// ---------------------------------------------------------------------------

const TOOL_GROUPS: Record<string, { label: string; tools: { name: string; label: string }[] }> = {
  media: {
    label: '🎵 Media',
    tools: [
      { name: 'bot_play_soundtrack', label: 'Play Soundtrack' },
      { name: 'bot_stop_soundtrack', label: 'Stop Soundtrack' },
      { name: 'bot_youtube_search', label: 'YouTube Search' },
      { name: 'bot_youtube_play', label: 'YouTube Play' },
    ],
  },
  notes: {
    label: '📝 Notes',
    tools: [
      { name: 'bot_create_note', label: 'Create Note' },
      { name: 'bot_update_note', label: 'Update Note' },
      { name: 'bot_read_note', label: 'Read Note' },
      { name: 'bot_list_notes', label: 'List Notes' },
    ],
  },
  sprites: {
    label: '✨ Sprites',
    tools: [
      { name: 'bot_summon_sprite', label: 'Summon Sprite' },
    ],
  },
  experiences: {
    label: '🎮 Experiences',
    tools: [
      { name: 'bot_launch_experience', label: 'Launch Experience' },
      { name: 'bot_list_experiences', label: 'List Experiences' },
    ],
  },
  system: {
    label: '⚙️ System',
    tools: [
      { name: 'bot_open_settings', label: 'Open Settings' },
      { name: 'bot_open_profile', label: 'Open Profile' },
    ],
  },
  social: {
    label: '🔗 Social',
    tools: [
      { name: 'bot_share_note', label: 'Share Note' },
      { name: 'bot_share_sprite', label: 'Share Sprite' },
    ],
  },
};

const BOT_TYPE_PRESETS: Record<SpriteBotType, { label: string; description: string }> = {
  companion: { label: 'Companion', description: 'A friendly chat buddy' },
  assistant: { label: 'Assistant', description: 'Task-oriented helper' },
  game: { label: 'Game', description: 'Interactive game master' },
  custom: { label: 'Custom', description: 'Full control' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SpriteBotConfigPanelProps {
  spriteId: string;
  spriteName: string | null;
  initialConfig?: SpriteBotConfig | null;
  onClose: () => void;
  onSaved?: (config: SpriteBotConfig) => void;
}

const DEFAULT_CONFIG: SpriteBotConfig = {
  botType: 'companion',
  tools: [],
  systemPrompt: '',
  greeting: '',
  behaviors: [],
};

export default function SpriteBotConfigPanel({
  spriteId,
  spriteName,
  initialConfig,
  onClose,
  onSaved,
}: SpriteBotConfigPanelProps) {
  const [config, setConfig] = useState<SpriteBotConfig>(initialConfig ?? DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load existing config from API on mount if no initialConfig provided
  useEffect(() => {
    if (initialConfig) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/summon-ai-sprite/${spriteId}`);
        if (!res.ok) return;
        const data = await res.json();
        const existing = data?.sprite?.botConfig;
        if (!cancelled && existing) {
          setConfig({ ...DEFAULT_CONFIG, ...existing });
        }
      } catch {
        // ignore — use defaults
      }
    })();
    return () => { cancelled = true; };
  }, [spriteId, initialConfig]);

  const update = useCallback(<K extends keyof SpriteBotConfig>(key: K, value: SpriteBotConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  // Tool toggle
  const toggleTool = useCallback((toolName: string) => {
    setConfig(prev => {
      const tools = prev.tools.includes(toolName)
        ? prev.tools.filter(t => t !== toolName)
        : [...prev.tools, toolName];
      return { ...prev, tools };
    });
    setDirty(true);
  }, []);

  // Behavior CRUD
  const addBehavior = useCallback(() => {
    const newBehavior: SpriteBehavior = {
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trigger: '',
      action: '',
      enabled: true,
    };
    setConfig(prev => ({ ...prev, behaviors: [...prev.behaviors, newBehavior] }));
    setDirty(true);
  }, []);

  const updateBehavior = useCallback((id: string, field: keyof SpriteBehavior, value: string | boolean) => {
    setConfig(prev => ({
      ...prev,
      behaviors: prev.behaviors.map(b => b.id === id ? { ...b, [field]: value } : b),
    }));
    setDirty(true);
  }, []);

  const removeBehavior = useCallback((id: string) => {
    setConfig(prev => ({ ...prev, behaviors: prev.behaviors.filter(b => b.id !== id) }));
    setDirty(true);
  }, []);

  // Save
  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/summon-ai-sprite/${spriteId}/bot-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botConfig: config }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Save failed (${res.status})`);
      }
      setDirty(false);
      onSaved?.(config);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [spriteId, config, onSaved]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      style={{ fontFamily: 'Gohufont, monospace' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-white/30 bg-slate-900/95 p-5 text-white shadow-2xl backdrop-blur-md [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.5)_transparent]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">⚙️ Bot Config</h2>
            <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{spriteName ?? 'Sprite'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/20 focus:outline-none"
          >
            ✕
          </button>
        </div>

        {/* Bot Type Selector */}
        <section className="mb-4">
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Type</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(BOT_TYPE_PRESETS) as SpriteBotType[]).map(type => (
              <button
                key={type}
                type="button"
                onClick={() => update('botType', type)}
                className={`rounded-lg px-2 py-1.5 text-[10px] font-semibold transition ${
                  config.botType === type
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-white/10 text-slate-300 hover:bg-white/20'
                }`}
              >
                {BOT_TYPE_PRESETS[type].label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[9px] text-slate-500">{BOT_TYPE_PRESETS[config.botType].description}</p>
        </section>

        {/* System Prompt */}
        <section className="mb-4">
          <label className="block text-[11px] font-semibold text-slate-300 mb-1">System Prompt</label>
          <textarea
            value={config.systemPrompt}
            onChange={e => update('systemPrompt', e.target.value)}
            placeholder="Override or augment the sprite's personality…"
            rows={3}
            className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[11px] text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
          />
        </section>

        {/* Greeting */}
        <section className="mb-4">
          <label className="block text-[11px] font-semibold text-slate-300 mb-1">Greeting</label>
          <input
            value={config.greeting}
            onChange={e => update('greeting', e.target.value)}
            placeholder="Custom first message when sprite activates…"
            className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </section>

        {/* Tool Picker */}
        <section className="mb-4">
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
            Tools <span className="text-slate-500 font-normal">({config.tools.length} enabled)</span>
          </label>
          <div className="space-y-2 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-2 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.4)_transparent]">
            {Object.entries(TOOL_GROUPS).map(([groupKey, group]) => (
              <div key={groupKey}>
                <p className="text-[10px] font-semibold text-slate-400 mb-0.5">{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.tools.map(tool => {
                    const active = config.tools.includes(tool.name);
                    return (
                      <button
                        key={tool.name}
                        type="button"
                        onClick={() => toggleTool(tool.name)}
                        className={`rounded px-2 py-0.5 text-[9px] font-medium transition ${
                          active
                            ? 'bg-indigo-600/80 text-white'
                            : 'bg-white/10 text-slate-400 hover:bg-white/20'
                        }`}
                      >
                        {tool.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Behaviors */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-slate-300">Behaviors</label>
            <button
              type="button"
              onClick={addBehavior}
              className="rounded bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-indigo-300 hover:bg-white/20"
            >
              + Add Rule
            </button>
          </div>
          {config.behaviors.length === 0 && (
            <p className="text-[9px] text-slate-500 italic">No behavior rules yet. Add trigger→action pairs.</p>
          )}
          <div className="space-y-2">
            {config.behaviors.map(behavior => (
              <div key={behavior.id} className="rounded-lg border border-white/10 bg-white/5 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <button
                    type="button"
                    onClick={() => updateBehavior(behavior.id, 'enabled', !behavior.enabled)}
                    className={`h-3 w-3 rounded-sm border ${
                      behavior.enabled
                        ? 'border-indigo-400 bg-indigo-500'
                        : 'border-white/30 bg-transparent'
                    }`}
                  />
                  <span className="text-[9px] text-slate-400 flex-1">Trigger → Action</span>
                  <button
                    type="button"
                    onClick={() => removeBehavior(behavior.id)}
                    className="text-[10px] text-slate-500 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </div>
                <input
                  value={behavior.trigger}
                  onChange={e => updateBehavior(behavior.id, 'trigger', e.target.value)}
                  placeholder="When… (e.g. user says goodnight)"
                  className="w-full rounded border border-white/15 bg-white/5 px-2 py-1 text-[10px] text-white placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none mb-1"
                />
                <input
                  value={behavior.action}
                  onChange={e => updateBehavior(behavior.id, 'action', e.target.value)}
                  placeholder="Then… (e.g. play lullaby soundtrack)"
                  className="w-full rounded border border-white/15 bg-white/5 px-2 py-1 text-[10px] text-white placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Error */}
        {error && <p className="mb-3 text-[10px] text-rose-400">{error}</p>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className={`rounded-lg px-4 py-1.5 text-[11px] font-semibold text-white shadow transition ${
              saving || !dirty
                ? 'bg-indigo-400/50 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
