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

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentConfig {
  id: string;
  model?: {
    primary?: string;
  };
  [key: string]: unknown;
}

interface BindingConfig {
  agentId: string;
  match: {
    channel?: string;
    [key: string]: unknown;
  };
}

interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
      };
    };
    list?: AgentConfig[];
  };
  bindings?: BindingConfig[];
}

// ── Constants ──────────────────────────────────────────────────────────────

// Available channels that can be configured
const CHANNELS = [
  { id: 'discord', name: 'Discord', icon: '💬', description: 'Discord server interactions' },
  { id: 'telegram', name: 'Telegram', icon: '✈️', description: 'Telegram messaging' },
  { id: 'webchat', name: 'Voice/Webchat', icon: '🎙️', description: 'Voice calls and web chat interface' },
] as const;

// Available model tiers - maps to agents in OpenClaw config
const MODEL_TIERS = [
  { id: 'haiku', name: 'Haiku', icon: '⚡', description: 'Fast & efficient (Claude Haiku 4.5)', color: 'text-green-400' },
  { id: 'sonnet', name: 'Sonnet', icon: '⚖️', description: 'Balanced performance (Claude Sonnet 4.6)', color: 'text-blue-400' },
  { id: 'opus', name: 'Opus', icon: '🚀', description: 'Maximum capability (Claude Opus 4.8)', color: 'text-purple-400' },
] as const;

// Primary model options
const PRIMARY_MODELS = [
  { value: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8', tier: 'Premium' },
  { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', tier: 'Balanced' },
  { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'Fast' },
  { value: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5', tier: 'Premium' },
  { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', tier: 'Balanced' },
  { value: 'anthropic/claude-sonnet-4-0', label: 'Claude Sonnet 4.0', tier: 'Balanced' },
] as const;

// ── Component ──────────────────────────────────────────────────────────────

export function ChannelModelsPanel() {
  const [config, setConfig] = useState<OpenClawConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  
  // Current settings
  const [primaryModel, setPrimaryModel] = useState<string>('');
  const [channelAgents, setChannelAgents] = useState<Record<string, string>>({});
  
  // Track if there are unsaved changes
  const [originalPrimary, setOriginalPrimary] = useState<string>('');
  const [originalChannelAgents, setOriginalChannelAgents] = useState<Record<string, string>>({});

  // Load current config
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/openclaw-config', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        throw new Error('Failed to load OpenClaw config');
      }
      const data: OpenClawConfig = await res.json();
      setConfig(data);

      // Extract primary model
      const primary = data?.agents?.defaults?.model?.primary || '';
      setPrimaryModel(primary);
      setOriginalPrimary(primary);

      // Extract channel bindings
      const bindings: Record<string, string> = {};
      if (data?.bindings) {
        for (const binding of data.bindings) {
          if (binding.match.channel) {
            bindings[binding.match.channel] = binding.agentId;
          }
        }
      }
      setChannelAgents(bindings);
      setOriginalChannelAgents(bindings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  const hasChanges = 
    primaryModel !== originalPrimary || 
    JSON.stringify(channelAgents) !== JSON.stringify(originalChannelAgents);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    setError(null);

    try {
      // Build the bindings array from current channel agents
      const bindings: BindingConfig[] = CHANNELS.map(channel => ({
        agentId: channelAgents[channel.id] || 'sonnet',
        match: { channel: channel.id }
      }));

      // Prepare the patch
      const patch: OpenClawConfig = {
        agents: {
          defaults: {
            model: {
              primary: primaryModel
            }
          }
        },
        bindings
      };

      const res = await fetch('/api/openclaw-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to save configuration');
      }

      const result = await res.json();
      
      // Update original values to match current (clear unsaved changes)
      setOriginalPrimary(primaryModel);
      setOriginalChannelAgents({ ...channelAgents });
      
      setSaveMessage('✓ Configuration saved! Gateway is restarting...');
      
      // Reload config after a brief delay to confirm changes
      setTimeout(() => {
        loadConfig();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 5000);
    }
  };

  const handleReset = () => {
    setPrimaryModel(originalPrimary);
    setChannelAgents({ ...originalChannelAgents });
  };

  // Get the model tier info for a given agent ID
  const getTierForAgent = (agentId: string) => {
    return MODEL_TIERS.find(t => t.id === agentId) || MODEL_TIERS[1]; // Default to sonnet
  };

  if (loading) {
    return (
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardContent className="p-8">
          <div className="flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-2xl mb-2">⚙️</div>
              <div className="text-sm">Loading configuration...</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4" style={FONT}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
              <span className="text-xl">⚠️</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-red-300 font-medium">Error</div>
              <div className="text-xs text-gray-400 mt-1">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Success Message */}
      {saveMessage && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4" style={FONT}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
              <span className="text-xl">✓</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-green-300 font-medium">{saveMessage}</div>
            </div>
          </div>
        </div>
      )}

      {/* Primary/Orchestrator Model Section */}
      <Card className="border-gray-700 bg-gray-800 ring-1 ring-purple-500/30" style={FONT}>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-white" style={FONT}>
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <span className="text-xl">🧠</span>
            </div>
            <div>
              <div className="font-medium flex items-center gap-2">
                Primary/Orchestrator Model
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-normal">
                  BACKBONE
                </span>
              </div>
              <p className="text-sm text-gray-400 font-normal">
                The main AI model that powers Pearl across all channels
              </p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          <div className="text-xs text-gray-400 mb-3">
            This is the primary model used by the OpenClaw gateway for all agent sessions.
            It serves as the backbone for Pearl's intelligence.
          </div>
          
          <select
            value={primaryModel}
            onChange={(e) => setPrimaryModel(e.target.value)}
            disabled={saving}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white focus:border-purple-500 focus:outline-none disabled:opacity-50"
            style={FONT}
          >
            <option value="" disabled>Select primary model...</option>
            {PRIMARY_MODELS.map(model => (
              <option key={model.value} value={model.value}>
                {model.label} ({model.tier})
              </option>
            ))}
          </select>

          {primaryModel && (
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <span className="text-green-400">Current:</span>
              <code className="text-purple-400">
                {PRIMARY_MODELS.find(m => m.value === primaryModel)?.label || primaryModel}
              </code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Channel-Specific Models Section */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2" style={FONT}>
            📡 Per-Channel Model Assignment
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Choose which model tier each communication channel uses. Different channels can use different models to optimize for speed or capability.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          <div className="space-y-3">
            {CHANNELS.map(channel => {
              const currentAgent = channelAgents[channel.id] || 'sonnet';
              const tier = getTierForAgent(currentAgent);
              
              return (
                <div
                  key={channel.id}
                  className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 hover:border-purple-500/40 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Channel Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">{channel.icon}</span>
                        <div className="text-sm text-white font-medium">{channel.name}</div>
                      </div>
                      <div className="text-xs text-gray-500 mb-3">{channel.description}</div>
                      
                      {/* Model Tier Selector */}
                      <div className="flex flex-wrap gap-2">
                        {MODEL_TIERS.map(modelTier => {
                          const isSelected = currentAgent === modelTier.id;
                          return (
                            <button
                              key={modelTier.id}
                              onClick={() => setChannelAgents(prev => ({ ...prev, [channel.id]: modelTier.id }))}
                              disabled={saving}
                              className={`flex-1 min-w-[140px] rounded-lg border px-3 py-2 text-left transition-all disabled:opacity-50 ${
                                isSelected
                                  ? 'border-purple-500 bg-purple-500/15 shadow-lg shadow-purple-500/10'
                                  : 'border-gray-700 bg-gray-900 hover:border-purple-500/40 hover:bg-gray-800'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-base">{modelTier.icon}</span>
                                <span className={`text-sm font-medium ${isSelected ? modelTier.color : 'text-gray-400'}`}>
                                  {modelTier.name}
                                </span>
                                {isSelected && (
                                  <span className="ml-auto">
                                    <span className="text-xs text-purple-400">✓</span>
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500">
                                {modelTier.description}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Model Tier Reference */}
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 mt-4">
            <div className="text-xs text-blue-300 mb-2 font-medium">ℹ️ Model Tier Reference</div>
            <div className="space-y-1 text-xs text-gray-400">
              {MODEL_TIERS.map(tier => (
                <div key={tier.id} className="flex items-center gap-2">
                  <span>{tier.icon}</span>
                  <span className={tier.color}>{tier.name}:</span>
                  <span>{tier.description}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save/Reset Controls */}
      {hasChanges && (
        <Card className="border-yellow-600/50 bg-yellow-900/10" style={FONT}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <div className="text-sm text-yellow-400 font-medium">Unsaved Changes</div>
                  <div className="text-xs text-gray-400">
                    Save your changes to apply the new model configuration
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  style={FONT}
                >
                  Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg border border-green-600 bg-green-600/15 text-green-300 text-sm hover:bg-green-600/25 disabled:opacity-50 transition-colors"
                  style={FONT}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Footer */}
      <div className="text-xs text-gray-500 text-center" style={FONT}>
        Changes take effect immediately after saving. The OpenClaw gateway will restart automatically.
      </div>
    </div>
  );
}
