'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { Button } from '@interface/components/ui/button';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@interface/components/ui/select';
import { Switch } from '@interface/components/ui/switch';
import { getClientLogger } from '@interface/lib/client-logger';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;
const logger = getClientLogger('[connections_panel]');

interface Provider {
  id: string;
  name: string;
  icon: string;
  description: string;
  getKeyUrl: string;
  models: { id: string; name: string }[];
}

const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🧠',
    description: 'Claude models via direct API',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5' },
      { id: 'anthropic/claude-opus-4-1', name: 'Claude Opus 4.1' },
      { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { id: 'anthropic/claude-sonnet-4-0', name: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet' },
      { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      { id: 'anthropic/claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
      { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🤖',
    description: 'GPT and o-series models via direct API',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'openai/gpt-4.1', name: 'GPT-4.1' },
      { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'openai/o3', name: 'o3' },
      { id: 'openai/o3-mini', name: 'o3 Mini' },
      { id: 'openai/o4-mini', name: 'o4 Mini' },
      { id: 'openai/o1', name: 'o1' },
      { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    description: 'Access 200+ models from multiple providers',
    getKeyUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'openrouter/anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
      { id: 'openrouter/anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
      { id: 'openrouter/anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
      { id: 'openrouter/anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
      { id: 'openrouter/anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
      { id: 'openrouter/openai/gpt-5', name: 'GPT-5' },
      { id: 'openrouter/openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openrouter/openai/o3', name: 'o3' },
      { id: 'openrouter/openai/o4-mini', name: 'o4 Mini' },
      { id: 'openrouter/google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
      { id: 'openrouter/google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      { id: 'openrouter/google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'openrouter/google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'openrouter/x-ai/grok-4', name: 'Grok 4' },
      { id: 'openrouter/x-ai/grok-3', name: 'Grok 3' },
      { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'openrouter/deepseek/deepseek-r1', name: 'DeepSeek R1' },
      { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'openrouter/qwen/qwen3-235b-a22b', name: 'Qwen 3 235B' },
      { id: 'openrouter/mistralai/mistral-large', name: 'Mistral Large' },
    ],
  },
  {
    id: 'google',
    name: 'Google AI',
    icon: '💎',
    description: 'Gemini models via direct API',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
      { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    icon: '⚡',
    description: 'Grok models by xAI',
    getKeyUrl: 'https://console.x.ai/',
    models: [
      { id: 'xai/grok-4', name: 'Grok 4' },
      { id: 'xai/grok-4-fast', name: 'Grok 4 Fast' },
      { id: 'xai/grok-3', name: 'Grok 3' },
      { id: 'xai/grok-3-mini', name: 'Grok 3 Mini' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    description: 'Ultra-fast inference for open models',
    getKeyUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'groq/llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
      { id: 'groq/llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
      { id: 'groq/deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B' },
      { id: 'groq/qwen-qwq-32b', name: 'QwQ 32B' },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    icon: '🌊',
    description: 'Mistral AI models',
    getKeyUrl: 'https://console.mistral.ai/api-keys',
    models: [
      { id: 'mistral/mistral-large-latest', name: 'Mistral Large' },
      { id: 'mistral/mistral-medium-latest', name: 'Mistral Medium' },
      { id: 'mistral/mistral-small-latest', name: 'Mistral Small' },
      { id: 'mistral/codestral-latest', name: 'Codestral' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🔬',
    description: 'DeepSeek reasoning models',
    getKeyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (V3)' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
    ],
  },
];

interface ProviderStatus {
  connected: boolean;
  keyMasked?: string;
  envVar: string;
  enabled: boolean;
  authMode?: 'api_key' | 'token';
  authProfile?: string;
}

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

export function ConnectionsPanel() {
  const [currentModel, setCurrentModel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, ProviderStatus>>({});
  
  // Provider credential management
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [providerMessages, setProviderMessages] = useState<Record<string, string>>({});
  
  // Model selection
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [applyingModel, setApplyingModel] = useState(false);
  
  // Key visibility
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});

  // Load current model and provider statuses
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Load current model from OpenClaw config
        const configRes = await fetch('/api/openclaw-config');
        if (configRes.ok) {
          const data = await configRes.json();
          const model = data.agents?.defaults?.model?.primary || '';
          setCurrentModel(model);
          
          // Auto-select provider based on current model
          const providerPrefix = model.split('/')[0];
          const matchingProvider = PROVIDERS.find(p => p.id === providerPrefix);
          if (matchingProvider) {
            setSelectedProvider(matchingProvider.id);
            setSelectedModel(model);
          } else if (model) {
            // Default to first provider that has this model
            const hasModel = PROVIDERS.find(p => p.models.some(m => m.id === model));
            if (hasModel) {
              setSelectedProvider(hasModel.id);
              setSelectedModel(model);
            }
          }
        }
        
        // Load provider credential statuses
        const envRes = await fetch('/api/openclaw-env');
        if (envRes.ok) {
          const data = await envRes.json();
          setProviderStatuses(data.providers || {});
        }
      } catch (error) {
        logger.error('Failed to load configuration', { error });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSaveCredentials = async (providerId: string) => {
    const key = apiKeyInput.trim();
    if (!key) return;
    
    setSavingProvider(providerId);
    setProviderMessages(prev => ({ ...prev, [providerId]: '' }));
    
    try {
      const res = await fetch('/api/openclaw-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey: key }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        setProviderMessages(prev => ({
          ...prev,
          [providerId]: `Error: ${data.error || 'Failed to save'}`,
        }));
        return;
      }
      
      // Refresh provider statuses
      const envRes = await fetch('/api/openclaw-env');
      if (envRes.ok) {
        const envData = await envRes.json();
        setProviderStatuses(envData.providers || {});
      }
      
      setProviderMessages(prev => ({
        ...prev,
        [providerId]: '✓ Credentials saved. Gateway will restart.',
      }));
      setEditingProvider(null);
      setApiKeyInput('');
      
      setTimeout(() => {
        setProviderMessages(prev => ({ ...prev, [providerId]: '' }));
      }, 5000);
    } catch (error) {
      setProviderMessages(prev => ({
        ...prev,
        [providerId]: 'Error: Failed to save credentials',
      }));
    } finally {
      setSavingProvider(null);
    }
  };

  const handleRemoveCredentials = async (providerId: string) => {
    if (!confirm(`Remove ${PROVIDERS.find(p => p.id === providerId)?.name} credentials?`)) {
      return;
    }
    
    setSavingProvider(providerId);
    
    try {
      const res = await fetch(`/api/openclaw-env?provider=${providerId}`, {
        method: 'DELETE',
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        setProviderMessages(prev => ({
          ...prev,
          [providerId]: `Error: ${data.error || 'Failed to remove'}`,
        }));
        return;
      }
      
      // Refresh provider statuses
      const envRes = await fetch('/api/openclaw-env');
      if (envRes.ok) {
        const envData = await envRes.json();
        setProviderStatuses(envData.providers || {});
      }
      
      setProviderMessages(prev => ({
        ...prev,
        [providerId]: '✓ Credentials removed',
      }));
      
      setTimeout(() => {
        setProviderMessages(prev => ({ ...prev, [providerId]: '' }));
      }, 3000);
    } catch (error) {
      setProviderMessages(prev => ({
        ...prev,
        [providerId]: 'Error: Failed to remove credentials',
      }));
    } finally {
      setSavingProvider(null);
    }
  };

  const handleToggleProvider = async (providerId: string, enabled: boolean) => {
    setSavingProvider(providerId);
    try {
      const res = await fetch('/api/openclaw-env', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, enabled }),
      });

      if (!res.ok) {
        const data = await res.json();
        setProviderMessages(prev => ({
          ...prev,
          [providerId]: `Error: ${data.error || 'Failed to toggle'}`,
        }));
        return;
      }

      // Refresh provider statuses
      const envRes = await fetch('/api/openclaw-env');
      if (envRes.ok) {
        const envData = await envRes.json();
        setProviderStatuses(envData.providers || {});
      }

      setProviderMessages(prev => ({
        ...prev,
        [providerId]: enabled ? '✓ Provider enabled' : '✓ Provider disabled',
      }));

      setTimeout(() => {
        setProviderMessages(prev => ({ ...prev, [providerId]: '' }));
      }, 3000);
    } catch (error) {
      setProviderMessages(prev => ({
        ...prev,
        [providerId]: 'Error: Failed to toggle provider',
      }));
    } finally {
      setSavingProvider(null);
    }
  };

  const handleApplyModel = async () => {
    if (!selectedModel) {
      alert('Please select a model');
      return;
    }

    setApplyingModel(true);
    try {
      const response = await fetch('/api/openclaw-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: {
            agents: {
              defaults: {
                model: {
                  primary: selectedModel,
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update config');
      }

      logger.info('Model updated successfully', { model: selectedModel });
      setCurrentModel(selectedModel);

      alert(`Model updated to ${selectedModel}. Gateway will restart.`);

    } catch (error: any) {
      logger.error('Failed to apply model change', { error });
      alert(`Failed to update model: ${error.message}`);
    } finally {
      setApplyingModel(false);
    }
  };

  const getCurrentProviderInfo = () => {
    if (!currentModel) return null;
    const providerPrefix = currentModel.split('/')[0];
    const provider = PROVIDERS.find(p => p.id === providerPrefix);
    return provider || { name: 'Unknown Provider', icon: '❓', id: 'unknown' };
  };

  const currentProviderInfo = getCurrentProviderInfo();
  const currentProvider = PROVIDERS.find(p => p.id === selectedProvider);
  const availableModels = currentProvider?.models || [];

  return (
    <div className="space-y-4">
      {/* Current Active Provider */}
      {!loading && currentProviderInfo && (
        <div 
          className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4" 
          style={FONT}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-purple-500/20">
              <span className="text-xl">{currentProviderInfo.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-purple-300">
                Active Provider: {currentProviderInfo.name}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Model: <code className="text-gray-300">{currentModel}</code>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full animate-pulse bg-purple-400" />
              <span className="text-xs text-purple-400">Active</span>
            </div>
          </div>
        </div>
      )}

      {/* Provider Credentials */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white" style={FONT}>
            🔑 Provider Credentials
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Connect your AI provider accounts to unlock models
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          {loading && (
            <div className="text-center text-gray-400 py-4">Loading providers...</div>
          )}
          
          {!loading && PROVIDERS.map(provider => {
            const status = providerStatuses[provider.id];
            const isConnected = status?.connected || false;
            const isEnabled = status?.enabled !== false;
            const isEditing = editingProvider === provider.id;
            const isSaving = savingProvider === provider.id;
            const message = providerMessages[provider.id];
            
            return (
              <div
                key={provider.id}
                className={`rounded-lg border bg-gray-900/50 p-4 space-y-3 transition-opacity ${
                  isConnected && !isEnabled 
                    ? 'border-gray-700/50 opacity-50' 
                    : 'border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-lg ${
                      isConnected && !isEnabled ? 'grayscale' : ''
                    }`}>
                      {provider.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium" style={FONT}>
                          {provider.name}
                        </span>
                        {isConnected && isEnabled && (
                          <>
                            <span className="flex items-center gap-1 rounded-full bg-green-900/40 px-2 py-0.5 text-xs text-green-400">
                              <CheckIcon /> Connected
                            </span>
                            {status?.authMode && (
                              <span className="rounded-full bg-blue-900/40 px-2 py-0.5 text-xs text-blue-400">
                                {status.authMode === 'token' ? '🔑 Token' : '🔐 API Key'}
                              </span>
                            )}
                          </>
                        )}
                        {isConnected && !isEnabled && (
                          <span className="flex items-center gap-1 rounded-full bg-yellow-900/40 px-2 py-0.5 text-xs text-yellow-400">
                            Disabled
                          </span>
                        )}
                        {!isConnected && (
                          <span className="text-xs text-gray-500">Not connected</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{provider.description}</p>
                    </div>
                  </div>
                  {isConnected && (
                    <div className="flex items-center gap-2" title="Temporarily disable this provider without deleting the key">
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) => handleToggleProvider(provider.id, checked)}
                        disabled={isSaving}
                      />
                    </div>
                  )}
                </div>

                {/* Show masked key if connected and not editing */}
                {isConnected && !isEditing && status?.keyMasked && (
                  <div className="space-y-2">
                    {status.authProfile && (
                      <div className="text-xs text-gray-400">
                        Profile: <code className="text-gray-300">{status.authProfile}</code>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-gray-400 flex-1 truncate overflow-hidden" style={FONT}>
                        {status.keyMasked === '(profile)' ? 
                          '••••••••••••••••' : 
                          (keyVisible[provider.id] ? 
                            (providerStatuses[provider.id]?.keyMasked || '') : 
                            status.keyMasked)}
                      </code>
                      {status.keyMasked !== '(profile)' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingProvider(provider.id)}
                          className="border-gray-600 text-gray-300 hover:bg-gray-700"
                          style={FONT}
                        >
                          Update
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRemoveCredentials(provider.id)}
                        disabled={isSaving}
                        className="border-red-600 text-red-400 hover:bg-red-900/20"
                        style={FONT}
                      >
                        Remove
                      </Button>
                    </div>
                    {status.authProfile && (
                      <div className="text-xs text-gray-500">
                        Note: Profile-based credentials are managed through the OpenClaw CLI
                      </div>
                    )}
                  </div>
                )}

                {/* Show connect/update form if not connected or editing */}
                {(!isConnected || isEditing) && (
                  <div className="space-y-2">
                    <Button
                      onClick={() => window.open(provider.getKeyUrl, '_blank')}
                      className="w-full bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
                      style={FONT}
                    >
                      Get {provider.name} API Key →
                    </Button>

                    <div className="flex gap-2">
                      <Input
                        placeholder={`Paste your ${provider.name} API key`}
                        value={isEditing ? apiKeyInput : ''}
                        onChange={e => setApiKeyInput(e.target.value)}
                        type="password"
                        className="border-gray-700 bg-gray-800 text-white flex-1"
                        style={FONT}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !isSaving) {
                            handleSaveCredentials(provider.id);
                          }
                        }}
                      />
                      <Button
                        onClick={() => handleSaveCredentials(provider.id)}
                        disabled={!apiKeyInput.trim() || isSaving}
                        className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                        style={FONT}
                      >
                        {isSaving ? '...' : 'Save'}
                      </Button>
                      {isEditing && isConnected && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingProvider(null);
                            setApiKeyInput('');
                          }}
                          className="border-gray-600 text-gray-400 hover:bg-gray-700"
                          style={FONT}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Status message */}
                {message && (
                  <p className={`text-xs ${message.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
                    {message}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Model Selection */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white" style={FONT}>
            🤖 Active Model
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Choose your default AI model (applies to all sessions)
          </CardDescription>
        </CardHeader>
        <CardContent style={FONT} className="space-y-4">
          {loading ? (
            <div className="text-center text-gray-400">Loading...</div>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-gray-300" style={FONT}>
                  Provider
                </Label>
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                  <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent className="border-gray-700 bg-gray-800">
                    {PROVIDERS.map(provider => (
                      <SelectItem
                        key={provider.id}
                        value={provider.id}
                        className="text-white hover:bg-gray-700"
                      >
                        <span className="flex items-center gap-2">
                          <span>{provider.icon}</span>
                          <span>{provider.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300" style={FONT}>
                  Model
                </Label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent className="border-gray-700 bg-gray-800">
                    {availableModels.map(model => (
                      <SelectItem
                        key={model.id}
                        value={model.id}
                        className="text-white hover:bg-gray-700"
                      >
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleApplyModel}
                disabled={applyingModel || !selectedModel || selectedModel === currentModel}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={FONT}
              >
                {applyingModel ? 'Applying...' : 'Apply Model Change'}
              </Button>

              {selectedModel === currentModel && selectedModel && (
                <p className="text-xs text-gray-500 text-center" style={FONT}>
                  This model is already active
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
