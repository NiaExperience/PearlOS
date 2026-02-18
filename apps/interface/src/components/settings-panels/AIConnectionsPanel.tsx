'use client';

import { useEffect, useState, useCallback } from 'react';

import { Button } from '@interface/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';
import { useResilientSession } from '@interface/hooks/use-resilient-session';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

interface ModelOption {
  id: string;
  name: string;
  description: string;
  category: 'recommended' | 'available';
}

const MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4', description: 'Fast, great for most tasks', category: 'recommended' },
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4', description: 'Most capable, best for complex work', category: 'recommended' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', description: "OpenAI's flagship", category: 'available' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', description: 'Open source, fast', category: 'available' },
];

interface ApiKeyConfig {
  key: string;
  label: string;
  metadataField: string;
  connectUrl: string;
  providerName: string;
}

const API_KEYS: ApiKeyConfig[] = [
  {
    key: 'anthropic',
    label: 'Anthropic API Key',
    metadataField: 'anthropic_api_key',
    connectUrl: 'https://console.anthropic.com/settings/keys',
    providerName: 'Anthropic',
  },
  {
    key: 'openai',
    label: 'OpenAI API Key',
    metadataField: 'openai_api_key',
    connectUrl: 'https://platform.openai.com/api-keys',
    providerName: 'OpenAI',
  },
];

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '••••' : '';
  return '••••••••' + key.slice(-4);
}

// Simple inline SVG icons
function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-400">
        <path d="M8 3C4 3 1 8 1 8s3 5 7 5 7-5 7-5-3-5-7-5z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-400">
      <path d="M8 3C4 3 1 8 1 8s3 5 7 5 7-5 7-5-3-5-7-5z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 7l4 4 6-7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
    />
  );
}

export function AIConnectionsPanel() {
  const { data: session } = useResilientSession();
  const user = session?.user;

  const [selectedModel, setSelectedModel] = useState<string>('anthropic/claude-sonnet-4-5');
  const [savingModel, setSavingModel] = useState(false);

  // API key state per provider
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyEditing, setKeyEditing] = useState<Record<string, boolean>>({});
  const [keySaving, setKeySaving] = useState<Record<string, boolean>>({});

  // OpenClaw status
  const [openclawStatus, setOpenclawStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [openclawModels, setOpenclawModels] = useState<string[]>([]);

  // Load user profile metadata
  const loadProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/userProfile?userId=${encodeURIComponent(user.id)}`);
      if (!res.ok) return;
      const data = await res.json();
      const profile = data.items?.[0];
      if (!profile?.metadata) return;
      const meta = profile.metadata;

      if (meta.preferred_model) setSelectedModel(meta.preferred_model);
      const newKeys: Record<string, string> = {};
      for (const cfg of API_KEYS) {
        if (meta[cfg.metadataField]) {
          newKeys[cfg.key] = meta[cfg.metadataField];
        }
      }
      setKeyValues(newKeys);
    } catch {
      // silent
    }
  }, [user?.id]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Check OpenClaw gateway
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/v1/models', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const models = (data.data || []).map((m: { id: string }) => m.id);
          setOpenclawModels(models);
          setOpenclawStatus('connected');
        } else {
          setOpenclawStatus('disconnected');
        }
      } catch {
        setOpenclawStatus('disconnected');
      }
    };
    check();
  }, []);

  const saveMetadataField = async (fields: Record<string, string>) => {
    if (!user?.id) return;
    const fetchRes = await fetch(`/api/userProfile?userId=${encodeURIComponent(user.id)}`);
    if (!fetchRes.ok) throw new Error('Failed to fetch profile');
    const fetchData = await fetchRes.json();
    const profile = fetchData.items?.[0];
    if (!profile) throw new Error('Profile not found');

    const res = await fetch('/api/userProfile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: profile.id,
        first_name: profile.first_name,
        email: profile.email,
        userId: profile.userId,
        metadata: { ...profile.metadata, ...fields },
        metadataOperation: 'replace',
      }),
    });
    if (!res.ok) throw new Error('Failed to save');
  };

  const handleModelSelect = async (modelId: string) => {
    setSelectedModel(modelId);
    setSavingModel(true);
    try {
      await saveMetadataField({ preferred_model: modelId });
    } catch {
      // silent
    } finally {
      setSavingModel(false);
    }
  };

  const handleSaveKey = async (cfg: ApiKeyConfig) => {
    const value = keyInputs[cfg.key]?.trim();
    if (!value) return;
    setKeySaving(prev => ({ ...prev, [cfg.key]: true }));
    try {
      await saveMetadataField({ [cfg.metadataField]: value });
      setKeyValues(prev => ({ ...prev, [cfg.key]: value }));
      setKeyEditing(prev => ({ ...prev, [cfg.key]: false }));
      setKeyInputs(prev => ({ ...prev, [cfg.key]: '' }));
    } catch {
      // silent
    } finally {
      setKeySaving(prev => ({ ...prev, [cfg.key]: false }));
    }
  };

  const recommended = MODELS.filter(m => m.category === 'recommended');
  const available = MODELS.filter(m => m.category === 'available');

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white" style={FONT}>
            🧠 Choose Your AI Brain
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Pick which AI model powers your experience
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          {savingModel && (
            <p className="text-xs text-blue-400">Saving...</p>
          )}

          <Label className="text-xs uppercase tracking-wider text-gray-500" style={FONT}>
            Recommended
          </Label>
          <div className="space-y-2">
            {recommended.map(m => (
              <button
                key={m.id}
                onClick={() => handleModelSelect(m.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                  selectedModel === m.id
                    ? 'border-green-500/50 bg-green-900/20 text-white'
                    : 'border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600 hover:bg-gray-900'
                }`}
                style={FONT}
              >
                <div>
                  <div className="font-medium" style={FONT}>{m.name}</div>
                  <div className="text-xs text-gray-500" style={FONT}>{m.description}</div>
                </div>
                {selectedModel === m.id && <CheckIcon />}
              </button>
            ))}
          </div>

          <Label className="mt-4 text-xs uppercase tracking-wider text-gray-500" style={FONT}>
            Available
          </Label>
          <div className="space-y-2">
            {available.map(m => (
              <button
                key={m.id}
                onClick={() => handleModelSelect(m.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                  selectedModel === m.id
                    ? 'border-green-500/50 bg-green-900/20 text-white'
                    : 'border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600 hover:bg-gray-900'
                }`}
                style={FONT}
              >
                <div>
                  <div className="font-medium" style={FONT}>{m.name}</div>
                  <div className="text-xs text-gray-500" style={FONT}>{m.description}</div>
                </div>
                {selectedModel === m.id && <CheckIcon />}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* API Key Connections */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white" style={FONT}>
            🔑 API Connections
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Connect your AI provider accounts to unlock more models
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4" style={FONT}>
          {API_KEYS.map(cfg => {
            const hasKey = !!keyValues[cfg.key];
            const editing = keyEditing[cfg.key];
            const saving = keySaving[cfg.key];

            return (
              <div key={cfg.key} className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-white text-sm" style={FONT}>{cfg.providerName}</Label>
                    {hasKey && (
                      <span className="flex items-center gap-1 rounded-full bg-green-900/40 px-2 py-0.5 text-xs text-green-400">
                        <CheckIcon /> Connected
                      </span>
                    )}
                    {!hasKey && !editing && (
                      <span className="text-xs text-gray-500">Not connected</span>
                    )}
                  </div>
                </div>

                {/* Connected: show masked key */}
                {hasKey && !editing && (
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-gray-400" style={FONT}>
                      {keyVisible[cfg.key] ? keyValues[cfg.key] : maskKey(keyValues[cfg.key])}
                    </code>
                    <button
                      onClick={() => setKeyVisible(prev => ({ ...prev, [cfg.key]: !prev[cfg.key] }))}
                      className="p-1 hover:bg-gray-700 rounded"
                    >
                      <EyeIcon open={!!keyVisible[cfg.key]} />
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setKeyEditing(prev => ({ ...prev, [cfg.key]: true }))}
                      className="ml-auto border-gray-600 text-gray-300 hover:bg-gray-700 text-xs"
                      style={FONT}
                    >
                      Change
                    </Button>
                  </div>
                )}

                {/* Not connected or editing: show connect button + input */}
                {(!hasKey || editing) && (
                  <div className="space-y-2">
                    <Button
                      onClick={() => {
                        window.open(cfg.connectUrl, '_blank');
                        setKeyEditing(prev => ({ ...prev, [cfg.key]: true }));
                      }}
                      className="w-full bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
                      style={FONT}
                    >
                      {hasKey ? `Update ${cfg.providerName} Key` : `Connect ${cfg.providerName}`}
                    </Button>

                    {(editing || !hasKey) && (
                      <div className="flex gap-2">
                        <Input
                          placeholder={`Paste your ${cfg.providerName} API key`}
                          value={keyInputs[cfg.key] || ''}
                          onChange={e => setKeyInputs(prev => ({ ...prev, [cfg.key]: e.target.value }))}
                          type="password"
                          className="border-gray-700 bg-gray-800 text-white flex-1"
                          style={FONT}
                        />
                        <Button
                          onClick={() => handleSaveKey(cfg)}
                          disabled={!keyInputs[cfg.key]?.trim() || saving}
                          className="bg-green-600 hover:bg-green-700 text-white"
                          style={FONT}
                        >
                          {saving ? '...' : 'Save'}
                        </Button>
                        {editing && hasKey && (
                          <Button
                            variant="outline"
                            onClick={() => setKeyEditing(prev => ({ ...prev, [cfg.key]: false }))}
                            className="border-gray-600 text-gray-400 hover:bg-gray-700"
                            style={FONT}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* OpenClaw Gateway Status */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white" style={FONT}>
            <StatusDot connected={openclawStatus === 'connected'} />
            OpenClaw Gateway
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            {openclawStatus === 'checking' && 'Checking connection...'}
            {openclawStatus === 'connected' && 'Connected — your AI gateway is running'}
            {openclawStatus === 'disconnected' && 'Not reachable — gateway may be offline'}
          </CardDescription>
        </CardHeader>
        {openclawStatus === 'connected' && openclawModels.length > 0 && (
          <CardContent style={FONT}>
            <Label className="text-xs uppercase tracking-wider text-gray-500 mb-2 block" style={FONT}>
              Available Models
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {openclawModels.map(m => (
                <span
                  key={m}
                  className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1 text-xs text-gray-400"
                  style={FONT}
                >
                  {m}
                </span>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
