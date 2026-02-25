'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelInfo {
  id: string;
  name: string;
  modelId: string;
  description: string;
  provider: string;
}

interface ModelSettingsResponse {
  config: Record<string, string>;
  availableModels: Record<string, ModelInfo>;
  taskTypes: Record<string, { key: string; label: string; description: string; envVar: string; defaultModel: string }>;
}

interface PresetApiResponse {
  current: string;
  models: {
    BOT_FAST_MODEL: string | null;
    BOT_OPENCLAW_MODEL: string | null;
    BOT_ESCALATION_MODEL: string | null;
  };
  presets: Record<string, { name: string; description: string; models: Record<string, string> }>;
}

interface RecommendationTier {
  tier: string;
  icon: string;
  cost: string;
  assignments: Record<string, string>;
}

// ── Constants ──────────────────────────────────────────────────────────────

// Full model list — synced with AVAILABLE_MODELS in the API route.
// Grouped by provider for the primary dropdown.
const PRIMARY_MODELS = [
  // ─ Anthropic (Direct API) 💎 ─
  { value: 'anthropic/claude-opus-4-6', label: '💎 Claude Opus 4.6 (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-opus-4-5', label: '💎 Claude Opus 4.5 (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-opus-4-1', label: '💎 Claude Opus 4.1 (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-sonnet-4-5', label: '💎 Claude Sonnet 4.5 (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-sonnet-4-0', label: '💎 Claude Sonnet 4 (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-haiku-4-5', label: '💎 Claude Haiku 4.5 (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-3-7-sonnet-latest', label: '💎 Claude 3.7 Sonnet (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-3-5-sonnet-20241022', label: '💎 Claude 3.5 Sonnet (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-3-5-haiku-latest', label: '💎 Claude 3.5 Haiku (Anthropic)', provider: 'Anthropic' },
  { value: 'anthropic/claude-3-opus-20240229', label: '💎 Claude 3 Opus (Anthropic)', provider: 'Anthropic' },
  // ─ Anthropic (via OpenRouter) 💰 ─
  { value: 'openrouter/anthropic/claude-opus-4.6', label: '💰 Claude Opus 4.6 (OpenRouter)', provider: 'OpenRouter' },
  { value: 'openrouter/anthropic/claude-opus-4.5', label: '💰 Claude Opus 4.5 (OpenRouter)', provider: 'OpenRouter' },
  { value: 'openrouter/anthropic/claude-sonnet-4.5', label: '💰 Claude Sonnet 4.5 (OpenRouter)', provider: 'OpenRouter' },
  { value: 'openrouter/anthropic/claude-haiku-4.5', label: '💰 Claude Haiku 4.5 (OpenRouter)', provider: 'OpenRouter' },
  { value: 'openrouter/anthropic/claude-3.7-sonnet', label: '💰 Claude 3.7 Sonnet (OpenRouter)', provider: 'OpenRouter' },
  // ─ OpenAI (Direct API) 💎 ─
  { value: 'openai/gpt-5', label: '💎 GPT-5 (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/gpt-4o', label: '💎 GPT-4o (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/gpt-4o-mini', label: '💎 GPT-4o Mini (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/gpt-4.1', label: '💎 GPT-4.1 (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/gpt-4.1-mini', label: '💎 GPT-4.1 Mini (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/o3', label: '💎 O3 (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/o3-mini', label: '💎 O3 Mini (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/o4-mini', label: '💎 O4 Mini (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/o1', label: '💎 O1 (OpenAI)', provider: 'OpenAI' },
  { value: 'openai/gpt-4-turbo', label: '💎 GPT-4 Turbo (OpenAI)', provider: 'OpenAI' },
  // ─ OpenAI (via OpenRouter) 💰 ─
  { value: 'openrouter/openai/gpt-5', label: '💰 GPT-5 (OpenRouter)', provider: 'OpenRouter' },
  { value: 'openrouter/openai/gpt-4o', label: '💰 GPT-4o (OpenRouter)', provider: 'OpenRouter' },
  { value: 'openrouter/openai/o3', label: '💰 O3 (OpenRouter)', provider: 'OpenRouter' },
  { value: 'openrouter/openai/o4-mini', label: '💰 O4 Mini (OpenRouter)', provider: 'OpenRouter' },
  // ─ xAI (via OpenRouter) 💰 ─
  { value: 'openrouter/x-ai/grok-4', label: '💰 Grok 4 (xAI via OpenRouter)', provider: 'xAI via OpenRouter' },
  { value: 'openrouter/x-ai/grok-4-fast', label: '💰 Grok 4 Fast (xAI via OpenRouter)', provider: 'xAI via OpenRouter' },
  { value: 'openrouter/x-ai/grok-3', label: '💰 Grok 3 (xAI via OpenRouter)', provider: 'xAI via OpenRouter' },
  { value: 'openrouter/x-ai/grok-3-mini', label: '💰 Grok 3 Mini (xAI via OpenRouter)', provider: 'xAI via OpenRouter' },
  // ─ Google (via OpenRouter) 💰 ─
  { value: 'openrouter/google/gemini-3-pro-preview', label: '💰 Gemini 3 Pro (Google via OpenRouter)', provider: 'Google via OpenRouter' },
  { value: 'openrouter/google/gemini-3-flash-preview', label: '💰 Gemini 3 Flash (Google via OpenRouter)', provider: 'Google via OpenRouter' },
  { value: 'openrouter/google/gemini-2.5-pro', label: '💰 Gemini 2.5 Pro (Google via OpenRouter)', provider: 'Google via OpenRouter' },
  { value: 'openrouter/google/gemini-2.5-flash', label: '💰 Gemini 2.5 Flash (Google via OpenRouter)', provider: 'Google via OpenRouter' },
  // ─ DeepSeek (via OpenRouter) 💰 ─
  { value: 'openrouter/deepseek/deepseek-r1', label: '💰 DeepSeek R1 (OpenRouter)', provider: 'DeepSeek via OpenRouter' },
  { value: 'openrouter/deepseek/deepseek-chat', label: '💰 DeepSeek V3 (OpenRouter)', provider: 'DeepSeek via OpenRouter' },
  { value: 'openrouter/deepseek/deepseek-v3.2', label: '💰 DeepSeek V3.2 (OpenRouter)', provider: 'DeepSeek via OpenRouter' },
  // ─ Qwen (via OpenRouter) 💰 ─
  { value: 'openrouter/qwen/qwen3-coder', label: '💰 Qwen 3 Coder (OpenRouter)', provider: 'Qwen via OpenRouter' },
  { value: 'openrouter/qwen/qwen3-235b-a22b', label: '💰 Qwen 3 235B (OpenRouter)', provider: 'Qwen via OpenRouter' },
  { value: 'openrouter/qwen/qwen-2.5-72b-instruct', label: '💰 Qwen 2.5 72B (OpenRouter)', provider: 'Qwen via OpenRouter' },
  // ─ MiniMax (via OpenRouter) 💰 ─
  { value: 'openrouter/minimax/minimax-m2.1', label: '💰 MiniMax M2.1 (OpenRouter)', provider: 'MiniMax via OpenRouter' },
  // ─ Moonshot / Kimi (via OpenRouter) 💰 ─
  { value: 'openrouter/moonshotai/kimi-k2', label: '💰 Kimi K2 (OpenRouter)', provider: 'Moonshot via OpenRouter' },
  { value: 'openrouter/moonshotai/kimi-k2.5', label: '💰 Kimi K2.5 (OpenRouter)', provider: 'Moonshot via OpenRouter' },
  // ─ Z-AI / GLM (via OpenRouter) 💰 ─
  { value: 'openrouter/z-ai/glm-5', label: '💰 GLM-5 (OpenRouter)', provider: 'Z-AI via OpenRouter' },
  { value: 'openrouter/z-ai/glm-4.7', label: '💰 GLM-4.7 (OpenRouter)', provider: 'Z-AI via OpenRouter' },
  // ─ Meta (via OpenRouter) 💰 ─
  { value: 'openrouter/meta-llama/llama-3.3-70b-instruct', label: '💰 Llama 3.3 70B (OpenRouter)', provider: 'Meta via OpenRouter' },
  { value: 'openrouter/meta-llama/llama-4-maverick', label: '💰 Llama 4 Maverick (OpenRouter)', provider: 'Meta via OpenRouter' },
  // ─ Mistral (via OpenRouter) 💰 ─
  { value: 'openrouter/mistralai/mistral-large', label: '💰 Mistral Large (OpenRouter)', provider: 'Mistral via OpenRouter' },
  { value: 'openrouter/mistralai/mistral-nemo', label: '💰 Mistral Nemo (OpenRouter)', provider: 'Mistral via OpenRouter' },
  // ─ Groq (Direct API) ⚡ ─
  { value: 'groq/llama-3.3-70b-versatile', label: '⚡ Llama 3.3 70B (Groq)', provider: 'Groq' },
  { value: 'groq/llama-3.1-70b-versatile', label: '⚡ Llama 3.1 70B (Groq)', provider: 'Groq' },
  { value: 'groq/llama-3.1-8b-instant', label: '⚡ Llama 3.1 8B (Groq)', provider: 'Groq' },
  { value: 'groq/deepseek-r1-distill-llama-70b', label: '⚡ DeepSeek R1 Distill (Groq)', provider: 'Groq' },
  // ─ Auto ─
  { value: 'openrouter/auto', label: '💰 Auto (Smart Routing) (OpenRouter)', provider: 'OpenRouter' },
];

// Group primary models by provider for <optgroup>
const PRIMARY_GROUPS = PRIMARY_MODELS.reduce<Record<string, typeof PRIMARY_MODELS>>((acc, m) => {
  (acc[m.provider] ??= []).push(m);
  return acc;
}, {});

// Preferred provider display order
const PROVIDER_ORDER = [
  'Anthropic', 'OpenAI', 'Groq',
  'OpenRouter',
  'xAI via OpenRouter', 'Google via OpenRouter', 'DeepSeek via OpenRouter', 'Qwen via OpenRouter',
  'MiniMax via OpenRouter', 'Moonshot via OpenRouter', 'Z-AI via OpenRouter', 'Meta via OpenRouter', 'Mistral via OpenRouter',
];

// All 8 bot model roles with user-friendly descriptions
const ALL_ROLES: { key: string; envVar: string; label: string; desc: string; longDesc: string; icon: string; api: 'preset' | 'settings' }[] = [
  {
    key: 'fast', envVar: 'BOT_FAST_MODEL', label: 'Quick Replies', icon: '⚡', api: 'preset',
    desc: 'Instant voice acknowledgments while Pearl works on your request',
    longDesc: 'When you ask Pearl to do something that takes time (like searching the web or running code), this fast model lets her say "Got it, working on that..." instantly while her main brain handles the real work in the background. Keeps the conversation flowing naturally. Use the fastest model you have here.',
  },
  {
    key: 'escalation', envVar: 'BOT_ESCALATION_MODEL', label: 'Deep Thinking', icon: '🔬', api: 'preset',
    desc: 'For complex problems that need extra brainpower',
    longDesc: 'When Pearl encounters something really challenging — like complex code, deep research, or tricky planning — she can automatically switch to this more powerful model. Use your best model here for the hardest tasks.',
  },
  {
    key: 'thinking', envVar: 'BOT_THINKING_MODEL', label: 'Extended Reasoning', icon: '💭', api: 'settings',
    desc: 'Deep thinking for math, logic, and multi-step problems',
    longDesc: 'For tasks that need careful step-by-step reasoning — solving math problems, working through logic puzzles, or planning complex multi-step processes. Some models are specifically designed for this kind of thinking.',
  },
  {
    key: 'vision', envVar: 'BOT_VISION_MODEL', label: 'Looking at Images', icon: '👁️', api: 'settings',
    desc: 'When Pearl needs to see and understand pictures, screenshots, or camera feeds',
    longDesc: "This model powers Pearl's visual understanding — analyzing images you send, looking at screenshots, reading camera feeds during video calls. Make sure to use a model that's good at understanding images, not just text.",
  },
  {
    key: 'tools', envVar: 'BOT_TOOLS_MODEL', label: 'Using Tools', icon: '🔧', api: 'settings',
    desc: 'Running commands, calling APIs, and handling structured tasks',
    longDesc: 'When Pearl needs to use tools — running shell commands, calling APIs, working with structured data — this model handles it. Models good at function calling and following precise instructions work best here.',
  },
  {
    key: 'swarm', envVar: 'BOT_SWARM_MODEL', label: 'Helper Agents', icon: '🐝', api: 'settings',
    desc: 'Background workers Pearl spawns to help with big tasks',
    longDesc: "When Pearl needs help, she can spawn mini-versions of herself to work in parallel — one researching while another writes code, etc. This model powers those helper agents. Usually you want something balanced between cost and capability here.",
  },
];

// Swarm agent type configs
const SWARM_AGENT_TYPES: { key: string; envVar: string; label: string; icon: string; desc: string }[] = [
  {
    key: 'regular', envVar: 'BOT_SWARM_REGULAR_MODEL', label: 'Simple Helpers', icon: '🤖',
    desc: 'For quick tasks like reading files, checking messages, or simple lookups',
  },
  {
    key: 'skilled', envVar: 'BOT_SWARM_SKILLED_MODEL', label: 'Expert Helpers', icon: '🧑‍💻',
    desc: 'For complex work like writing code, deep research, or multi-step projects',
  },
];

// Active roles in OpenClaw Session mode — these pipeline stages still matter
const OPENCLAW_ACTIVE_ROLES: { envVar: string; label: string; shortDesc: string; desc: string }[] = [
  {
    envVar: 'BOT_FAST_MODEL',
    label: 'Voice Quick Response',
    shortDesc: 'Fast model for instant voice acknowledgments',
    desc: 'Fast model for instant voice acknowledgments. Used by the non-blocking voice router for immediate spoken responses while the main agent processes tools in the background.',
  },
  {
    envVar: 'BOT_VISION_MODEL',
    label: 'Vision / Image Understanding',
    shortDesc: 'Camera frames, screenshots, visual input',
    desc: 'Model for Pearl Vision — camera frame analysis, screenshot understanding, and visual input processing during video calls.',
  },
  {
    envVar: 'BOT_THINKING_MODEL',
    label: 'Extended Reasoning',
    shortDesc: 'Deep chain-of-thought reasoning tasks',
    desc: 'Model for tasks requiring deep chain-of-thought reasoning.',
  },
];

// Managed roles in OpenClaw Session mode — handled by Gateway or Primary
const OPENCLAW_MANAGED_ROLES: { envVar: string; icon: string; label: string; managedBy: string }[] = [
  { envVar: 'BOT_OPENCLAW_MODEL', icon: '🧠', label: 'OpenClaw Session', managedBy: 'Pearl Mind Primary' },
  { envVar: 'BOT_ESCALATION_MODEL', icon: '🔬', label: 'Escalation', managedBy: 'OpenClaw Gateway' },
  { envVar: 'BOT_VOICE_MODEL', icon: '🎙️', label: 'Voice Model', managedBy: 'Pearl Mind Primary' },
  { envVar: 'BOT_TOOLS_MODEL', icon: '🔧', label: 'Tool Calls', managedBy: 'OpenClaw Gateway' },
  { envVar: 'BOT_SWARM_MODEL', icon: '🐝', label: 'Swarm', managedBy: 'Swarm section below' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Return a tooltip description for a provider. */
function getProviderTooltip(provider: string): string {
  const tips: Record<string, string> = {
    'Anthropic': 'Direct Anthropic API — best pricing 💎',
    'OpenAI': 'Direct OpenAI API — best pricing 💎',
    'OpenRouter': 'OpenRouter proxy — convenient but higher markup 💰',
    'xAI via OpenRouter': 'xAI via OpenRouter proxy 💰',
    'Google via OpenRouter': 'Google via OpenRouter proxy 💰',
    'DeepSeek via OpenRouter': 'DeepSeek via OpenRouter proxy 💰',
    'Qwen via OpenRouter': 'Qwen/Alibaba via OpenRouter proxy 💰',
    'MiniMax via OpenRouter': 'MiniMax via OpenRouter proxy 💰',
    'Moonshot via OpenRouter': 'Moonshot via OpenRouter proxy 💰',
    'Z-AI via OpenRouter': 'Z-AI/GLM via OpenRouter proxy 💰',
    'Meta via OpenRouter': 'Meta/Llama via OpenRouter proxy 💰',
    'Mistral via OpenRouter': 'Mistral via OpenRouter proxy 💰',
  };
  return tips[provider] || `${provider} API`;
}

/** Normalize model ID for display — strip `openrouter/` prefix for readability. */
function displayModelId(modelId: string): string {
  return modelId.replace(/^openrouter\//, '');
}

/** Return a human-readable model name from a model ID. */
function humanModelName(modelId: string): string {
  const stripped = displayModelId(modelId);
  const match = PRIMARY_MODELS.find(m => displayModelId(m.value) === stripped || m.value === modelId);
  return match?.label || stripped;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ModelSettingsPanel() {
  // Check if settings page is disabled
  const [settingsDisabled, setSettingsDisabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pearl_settings_disabled') === 'true';
    }
    return false;
  });

  // Listen for storage changes (in case disabled state is toggled in another tab/panel)
  useEffect(() => {
    const handleStorageChange = () => {
      if (typeof window !== 'undefined') {
        setSettingsDisabled(localStorage.getItem('pearl_settings_disabled') === 'true');
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      // Also check on interval in case it's same-tab change
      const interval = setInterval(handleStorageChange, 500);
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        clearInterval(interval);
      };
    }
  }, []);

  // Pearl Mind Primary
  const [openclawModel, setOpenclawModel] = useState('');
  const [openclawStatus, setOpenclawStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [savingPrimary, setSavingPrimary] = useState(false);
  const [primaryMessage, setPrimaryMessage] = useState<string | null>(null);

  // LLM mode detection
  const [llmMode, setLlmMode] = useState<string>('unknown');
  const [isOpenclawSession, setIsOpenclawSession] = useState(false);
  const [activeRoles, setActiveRoles] = useState<string[]>([]);

  // Bot model roles
  const [modelCatalog, setModelCatalog] = useState<Record<string, ModelInfo>>({});
  const [roleValues, setRoleValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  // Swarm agent types
  const [swarmValues, setSwarmValues] = useState<Record<string, string>>({});
  const [originalSwarmValues, setOriginalSwarmValues] = useState<Record<string, string>>({});

  // AI Config Advisor
  const [useCase, setUseCase] = useState('');
  const [recommendations, setRecommendations] = useState<RecommendationTier[] | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);

  // Expanded role detail (click to toggle)
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  // Provider connectivity status (from openclaw-env API)
  const [providerStatus, setProviderStatus] = useState<Record<string, { enabled: boolean; connected: boolean }>>({});

  // ── Load provider status (enabled + API key presence) ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/openclaw-env', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const status: Record<string, { enabled: boolean; connected: boolean }> = {};
          for (const [providerId, info] of Object.entries(data.providers || {})) {
            const providerInfo = info as any;
            status[providerId] = {
              enabled: providerInfo.enabled !== false,
              connected: providerInfo.connected === true,
            };
          }
          setProviderStatus(status);
        }
      } catch {
        // Default: show everything if we can't check
      }
    })();
  }, []);

  // ── Load LLM mode ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/bot/llm-mode', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          setLlmMode(data.mode || 'unknown');
          setIsOpenclawSession(data.isOpenclawSession === true);
          if (Array.isArray(data.activeRoles)) {
            setActiveRoles(data.activeRoles);
          }
        }
      } catch {
        // Non-critical — default to showing everything
      }
    })();
  }, []);

  // ── Load OpenClaw primary ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/openclaw-config', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const config = await res.json();
          setOpenclawModel(config?.agents?.defaults?.model?.primary || '');
          setOpenclawStatus('connected');
        } else {
          setOpenclawStatus('disconnected');
        }
      } catch {
        setOpenclawStatus('disconnected');
      }
    })();
  }, []);

  // ── Load bot role models ──
  const loadRoles = useCallback(async () => {
    try {
      const [settingsRes, presetRes] = await Promise.all([
        fetch('/api/bot/model-settings'),
        fetch('/api/bot/model-preset'),
      ]);
      const vals: Record<string, string> = {};

      if (settingsRes.ok) {
        const data: ModelSettingsResponse = await settingsRes.json();
        setModelCatalog(data.availableModels);
        // Map settings task keys to env var values
        for (const [taskKey, modelKey] of Object.entries(data.config)) {
          const model = data.availableModels[modelKey];
          const taskType = data.taskTypes[taskKey];
          if (taskType && model) {
            vals[taskType.envVar] = model.modelId;
          }
        }
      }

      if (presetRes.ok) {
        const data: PresetApiResponse = await presetRes.json();
        if (data.models.BOT_FAST_MODEL) vals['BOT_FAST_MODEL'] = data.models.BOT_FAST_MODEL;
        if (data.models.BOT_OPENCLAW_MODEL) vals['BOT_OPENCLAW_MODEL'] = data.models.BOT_OPENCLAW_MODEL;
        if (data.models.BOT_ESCALATION_MODEL) vals['BOT_ESCALATION_MODEL'] = data.models.BOT_ESCALATION_MODEL;
      }

      setRoleValues(vals);
      setOriginalValues(vals);

      // TODO: Load swarm agent type values from API/env when backend supports it
      // For now, default to empty (inherit from BOT_SWARM_MODEL)
      setSwarmValues({});
      setOriginalSwarmValues({});
    } catch {} finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  // ── Handlers ──

  const handlePrimaryModelChange = async (model: string) => {
    setSavingPrimary(true);
    setPrimaryMessage(null);
    try {
      // Patch both the default model AND the voice agent's model
      // The voice agent is used for Discord/Telegram/webchat sessions
      const res = await fetch('/api/openclaw-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: {
            agents: {
              defaults: { model: { primary: model } },
              // Update the voice agent to use the same primary model
              list: [{ id: 'voice', model: { primary: model } }],
            },
          },
        }),
      });
      if (res.ok) {
        setOpenclawModel(model);
        setPrimaryMessage('✓ Primary model updated');
      } else {
        setPrimaryMessage('Error: Failed to update');
      }
    } catch {
      setPrimaryMessage('Error: Gateway unreachable');
    } finally {
      setSavingPrimary(false);
      setTimeout(() => setPrimaryMessage(null), 4000);
    }
  };

  const setRoleValue = (envVar: string, modelId: string) => {
    setRoleValues(prev => ({ ...prev, [envVar]: modelId }));
  };

  const setSwarmValue = (envVar: string, modelId: string) => {
    setSwarmValues(prev => ({ ...prev, [envVar]: modelId }));
  };

  // Map provider display names → provider IDs that must be connected
  const PROVIDER_GROUP_DEPS: Record<string, string[]> = {
    'Anthropic': ['anthropic'],
    'OpenAI': ['openai'],
    'OpenRouter': ['openrouter'],
    'Groq': ['groq'],
    'xAI via OpenRouter': ['openrouter'],
    'Google via OpenRouter': ['openrouter'],
    'DeepSeek via OpenRouter': ['openrouter'],
    'Qwen via OpenRouter': ['openrouter'],
    'MiniMax via OpenRouter': ['openrouter'],
    'Moonshot via OpenRouter': ['openrouter'],
    'Z-AI via OpenRouter': ['openrouter'],
    'Meta via OpenRouter': ['openrouter'],
    'Mistral via OpenRouter': ['openrouter'],
  };

  // Check if a provider is ready to use (enabled + has API key)
  const isProviderReady = (providerId: string): boolean => {
    const status = providerStatus[providerId];
    if (!status) return false; // No status data = not ready
    return status.enabled && status.connected;
  };

  const hasProviderData = Object.keys(providerStatus).length > 0;

  // Smart filtering: Only show model groups where ALL required providers are ready
  const filteredPrimaryGroups = hasProviderData
    ? Object.fromEntries(
        Object.entries(PRIMARY_GROUPS).filter(([groupName, _models]) => {
          const requiredProviders = PROVIDER_GROUP_DEPS[groupName] || [];
          // All required providers must be both enabled AND connected
          return requiredProviders.every(providerId => isProviderReady(providerId));
        })
      )
    : PRIMARY_GROUPS; // Fallback: show all if we can't determine provider status

  // Map model provider names to provider IDs
  const getProviderIdFromModelId = (modelId: string): string | null => {
    // Check prefix to determine provider
    if (modelId.startsWith('anthropic/')) return 'anthropic';
    if (modelId.startsWith('openai/')) return 'openai';
    if (modelId.startsWith('openrouter/')) return 'openrouter';
    if (modelId.startsWith('groq/')) return 'groq';
    if (modelId.startsWith('google/')) return 'google';
    if (modelId.startsWith('xai/') || modelId.startsWith('x-ai/')) return 'xai';
    if (modelId.startsWith('deepseek/')) return 'deepseek';
    // Default fallback for unknown prefixes
    return null;
  };

  // Build a flat list of model options from catalog — filter by provider connectivity
  const modelOptions = Object.values(modelCatalog)
    .filter(m => {
      const providerId = getProviderIdFromModelId(m.modelId);
      // If we have provider data, filter by connectivity; otherwise show all
      return !hasProviderData || !providerId || isProviderReady(providerId);
    })
    .map(m => ({
      value: m.modelId,
      label: `${m.name} (${m.provider})`,
    }));
  // extraModels removed - all models now in backend catalog
  const allModelOptions = modelOptions.sort((a, b) => a.label.localeCompare(b.label));

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployStatus('Saving model settings...');
    try {
      // Step 1: Save all model role env vars to .env
      const allEnvVars: Record<string, string> = {};
      for (const role of ALL_ROLES) {
        if (roleValues[role.envVar]) {
          allEnvVars[role.envVar] = roleValues[role.envVar];
        }
      }
      // Add swarm agent type values
      for (const agent of SWARM_AGENT_TYPES) {
        if (swarmValues[agent.envVar]) {
          allEnvVars[agent.envVar] = swarmValues[agent.envVar];
        }
      }

      // Write to .env
      setDeployStatus('Writing model assignments to .env...');
      const envRes = await fetch('/api/bot/model-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directEnv: allEnvVars }),
      });
      if (!envRes.ok) {
        const data = await envRes.json().catch(() => ({ error: 'Unknown error' }));
        setDeployStatus(`❌ Error saving to .env: ${data.error || 'Failed'}`);
        return;
      }

      // Step 2: Update OpenClaw primary model (BOT_OPENCLAW_MODEL)
      const openclawModel = roleValues['BOT_OPENCLAW_MODEL'];
      if (openclawModel) {
        setDeployStatus('Updating OpenClaw primary model...');
        const configRes = await fetch('/api/openclaw-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patch: {
              agents: {
                defaults: {
                  model: {
                    primary: openclawModel,
                  },
                },
              },
            },
          }),
        });
        if (!configRes.ok) {
          setDeployStatus('⚠️ Saved to .env, but OpenClaw config update failed. May need manual restart.');
          setTimeout(() => setDeployStatus(null), 10000);
          return;
        }
      }

      // Step 3: Gateway restart (triggered automatically by openclaw-config API)
      setDeployStatus('Restarting OpenClaw gateway...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause for restart to begin

      // Step 4: Also restart the Pipecat bot gateway so it picks up new env vars
      setDeployStatus('Restarting bot gateway...');
      try {
        await fetch('/api/bot/restart', { method: 'POST' });
      } catch {
        // Non-fatal — bot restart is best-effort
      }
      await new Promise(resolve => setTimeout(resolve, 2000));

      setDeployStatus('✅ All changes applied! Both gateways restarting...');
      setOriginalValues({ ...roleValues });
      setOriginalSwarmValues({ ...swarmValues });
    } catch (err) {
      setDeployStatus(`❌ Error: ${err instanceof Error ? err.message : 'Deployment failed'}`);
    } finally {
      setDeploying(false);
      setTimeout(() => setDeployStatus(null), 8000);
    }
  };

  const handleGetRecommendations = async () => {
    if (!useCase.trim()) return;
    setAdvisorLoading(true);
    setAdvisorError(null);
    setRecommendations(null);

    const prompt = `You are a PearlOS model configuration advisor. The user wants to configure their AI assistant for: "${useCase}"

Recommend optimal model assignments for these 7 roles. Return ONLY valid JSON array with 3 tiers:

Roles and their env vars:
- BOT_FAST_MODEL: Fast/Voice — low latency voice responses
- BOT_OPENCLAW_MODEL: OpenClaw Session — primary reasoning bridge  
- BOT_ESCALATION_MODEL: Escalation — complex reasoning
- BOT_VOICE_MODEL: Voice pipeline specific
- BOT_TOOLS_MODEL: Tool/function calling
- BOT_SWARM_MODEL: Swarm/sub-agent orchestration
- BOT_THINKING_MODEL: Extended reasoning

Available models (use exact modelId values):
- groq/llama-3.3-70b (ultra fast, free tier)
- groq/llama-3.1-8b-instant (fastest, free tier)
- openrouter/z-ai/glm-5 (budget, good tools)
- deepseek/deepseek-chat (great value, strong reasoning)
- deepseek/deepseek-r1 (reasoning specialist)
- openai/gpt-4o (versatile)
- openai/o3-mini (fast reasoning)
- anthropic/claude-sonnet-4-5 (fast, capable, balanced)
- anthropic/claude-haiku-4-5 (fast and affordable)
- anthropic/claude-opus-4-6 (most capable)
- google/gemini-3-pro-preview (Google flagship)
- google/gemini-3-flash-preview (fast Gemini)
- mistralai/mistral-large (Mistral flagship)
- qwen/qwen3.5-plus (Alibaba Qwen)
- x-ai/grok-4.1-fast (xAI Grok)
- moonshotai/kimi-k2-0712-preview (Moonshot Kimi)

Return JSON array of exactly 3 objects:
[{"tier":"Budget","icon":"💰","cost":"~$5-15/mo","assignments":{"BOT_FAST_MODEL":"...","BOT_OPENCLAW_MODEL":"...","BOT_ESCALATION_MODEL":"...","BOT_VOICE_MODEL":"...","BOT_TOOLS_MODEL":"...","BOT_SWARM_MODEL":"...","BOT_THINKING_MODEL":"..."}},{"tier":"Balanced","icon":"⚖️","cost":"~$30-60/mo","assignments":{...}},{"tier":"Premium","icon":"🚀","cost":"~$100-200/mo","assignments":{...}}]

ONLY return the JSON array. No markdown, no explanation.`;

    try {
      const res = await fetch('/api/bot/model-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(35000),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || 'API request failed');
      }
      const { tiers } = await res.json();
      setRecommendations(tiers as RecommendationTier[]);
    } catch (err) {
      setAdvisorError(`Failed to get recommendations: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setAdvisorLoading(false);
    }
  };

  const applyRecommendation = (assignments: Record<string, string>) => {
    setRoleValues(prev => ({ ...prev, ...assignments }));
  };

  const hasChanges =
    JSON.stringify(roleValues) !== JSON.stringify(originalValues) ||
    JSON.stringify(swarmValues) !== JSON.stringify(originalSwarmValues);

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* ═══ Settings Disabled Banner ═══ */}
      {settingsDisabled && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4" style={FONT}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
              <span className="text-xl">🚫</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-orange-300 font-medium">
                Settings Page Disabled — Read-Only Mode
              </div>
              <div className="text-xs text-gray-400 mt-1">
                This page is currently disabled to prevent it from overriding OpenClaw configuration.
                All controls are disabled. Model changes should be made via OpenClaw or the Connections menu.
                To re-enable this page, go to Connections settings.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Provider Status Banner ═══ */}
      {hasProviderData && Object.keys(filteredPrimaryGroups).length === 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4" style={FONT}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
              <span className="text-xl">⚠️</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-orange-300 font-medium">
                No AI Providers Connected
              </div>
              <div className="text-xs text-gray-400 mt-1">
                No models available because no providers are enabled with valid API keys.
                Go to <strong>Connections</strong> settings to enable providers and add API keys.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Partial Connection Info ═══ */}
      {hasProviderData && Object.keys(filteredPrimaryGroups).length > 0 && Object.keys(filteredPrimaryGroups).length < Object.keys(PRIMARY_GROUPS).length && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3" style={FONT}>
          <div className="flex items-center gap-2">
            <span className="text-sm">ℹ️</span>
            <div className="text-xs text-blue-300">
              Showing models from {Object.keys(filteredPrimaryGroups).length} of {Object.keys(PRIMARY_GROUPS).length} provider groups.
              Enable more providers in <strong>Connections</strong> to see additional models.
            </div>
          </div>
        </div>
      )}

      {/* ═══ Selected Model Unavailable Warning ═══ */}
      {hasProviderData && (() => {
        const selectedModelId = roleValues['BOT_OPENCLAW_MODEL'];
        if (!selectedModelId) return null;
        
        // Check if selected model is in filtered groups
        const isAvailable = Object.values(filteredPrimaryGroups).some(group =>
          group.some(m => m.value === selectedModelId)
        );
        
        if (isAvailable) return null;
        
        // Model is selected but not available
        return (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4" style={FONT}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                <span className="text-xl">⚠️</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-yellow-300 font-medium">
                  Selected Model Unavailable
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Your selected model <strong>{humanModelName(selectedModelId)}</strong> is not available because its provider is disconnected or disabled.
                  Enable the provider in <strong>Connections</strong> or select a different model.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ Active Model Banner ═══ */}
      {isOpenclawSession && openclawModel && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 flex items-center gap-3" style={FONT}>
          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
            <span className="text-sm">🧠</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-purple-300 font-medium">
              Active Model: {humanModelName(openclawModel)}
            </div>
            <div className="text-xs text-gray-400">
              Used for all Pearl sessions — voice, Discord, Telegram, webchat
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400">Live</span>
          </div>
        </div>
      )}

      {/* ═══ Section A: Pearl Mind Primary ═══ */}
      <Card className={`border-gray-700 bg-gray-800 ${isOpenclawSession ? 'ring-1 ring-purple-500/30' : ''}`} style={FONT}>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-white" style={FONT}>
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <span className="text-xl">🧠</span>
            </div>
            <div>
              <div className="font-medium flex items-center gap-2">
                Pearl Mind — Primary
                {isOpenclawSession && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-normal">
                    ACTIVE
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 font-normal">
                {isOpenclawSession
                  ? 'This is the ONE model controlling all Pearl responses — voice, Discord, Telegram, webchat'
                  : 'OpenClaw gateway model for Discord, Telegram, and all sessions'}
              </p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          <div className={`flex items-center gap-2 text-sm ${openclawStatus === 'connected' ? 'text-green-400' : openclawStatus === 'checking' ? 'text-yellow-400' : 'text-red-400'}`}>
            <div className="w-2 h-2 rounded-full bg-current" />
            {openclawStatus === 'checking' && 'Checking...'}
            {openclawStatus === 'connected' && 'Connected to OpenClaw Gateway'}
            {openclawStatus === 'disconnected' && 'Gateway offline'}
          </div>

          <select
            value={openclawModel}
            onChange={(e) => handlePrimaryModelChange(e.target.value)}
            disabled={settingsDisabled || openclawStatus !== 'connected' || savingPrimary}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white focus:border-purple-500 focus:outline-none disabled:opacity-50"
            style={FONT}
          >
            <option value="" disabled>
              {Object.keys(filteredPrimaryGroups).length === 0 
                ? 'No providers connected — enable providers in Connections settings' 
                : 'Select model...'}
            </option>
            {PROVIDER_ORDER
              .filter(p => filteredPrimaryGroups[p])
              .map(provider => (
                <optgroup key={provider} label={`── ${provider} ${provider.includes('OpenRouter') ? '💰' : '💎'} ──`}>
                  {filteredPrimaryGroups[provider].map(m => (
                    <option key={m.value} value={m.value} title={getProviderTooltip(m.provider)}>{m.label}</option>
                  ))}
                </optgroup>
              ))}
          </select>

          <div className="text-xs text-gray-500">
            Active: <code className="text-purple-400">{openclawModel ? humanModelName(openclawModel) : 'Loading...'}</code>
            {openclawModel && <span className="text-gray-600 ml-2">({displayModelId(openclawModel)})</span>}
          </div>

          {isOpenclawSession && (
            <div className="text-xs text-purple-400/70 bg-purple-500/5 rounded-lg px-3 py-2">
              ✦ Changing this model takes effect immediately for all new Pearl responses.
              No bot restart needed.
            </div>
          )}

          {primaryMessage && (
            <p className={`text-xs ${primaryMessage.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
              {primaryMessage}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ═══ Section B: Model Roles ═══ */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2" style={FONT}>
            🎯 What Models Pearl Uses
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Pearl can use different AI models for different tasks. Pick the best model for each job — faster models for quick tasks, smarter models for hard problems.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          {loadingRoles ? (
            <p className="text-xs text-gray-500">Loading configuration...</p>
          ) : (
            /* ── All roles editable regardless of session mode ── */
            <>
              <div className="space-y-2">
                {ALL_ROLES.map(role => {
                  const currentVal = roleValues[role.envVar] || '';
                  const originalVal = originalValues[role.envVar] || '';
                  const isChanged = currentVal !== originalVal;
                  const isActive = originalVal !== '';
                  const isExpanded = expandedRole === role.envVar;
                  return (
                    <div key={role.envVar} className={`rounded-lg border p-3 hover:border-purple-500/40 transition-colors ${
                      isActive ? 'border-green-600/40 bg-gray-900/70' : 'border-gray-700 bg-gray-900/50'
                    }`}>
                      <div
                        className="flex items-center gap-3 mb-2 cursor-pointer select-none"
                        onClick={() => setExpandedRole(isExpanded ? null : role.envVar)}
                      >
                        <span className="text-lg w-8 text-center">{role.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white font-medium flex items-center gap-2">
                            {role.label}
                            {isActive && (
                              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                                Active
                              </span>
                            )}
                            {isChanged && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                                Changed
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">{role.desc}</div>
                        </div>
                        <span className="text-xs text-gray-600">{isExpanded ? '▾' : '▸'}</span>
                      </div>
                      {isExpanded && (
                        <p className="text-xs text-gray-400 mb-2 ml-11 leading-relaxed">{role.longDesc}</p>
                      )}
                      <select
                        value={currentVal}
                        onChange={(e) => setRoleValue(role.envVar, e.target.value)}
                        disabled={settingsDisabled}
                        className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none disabled:opacity-50"
                        style={FONT}
                      >
                        <option value="">
                          {allModelOptions.length === 0 
                            ? 'No providers connected — enable providers in Connections' 
                            : 'Not set (use default)'}
                        </option>
                        {allModelOptions.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                        {currentVal && !allModelOptions.find(o => o.value === currentVal) && (
                          <option value={currentVal}>{currentVal} (custom)</option>
                        )}
                      </select>
                      {isActive && (
                        <div className="text-xs text-gray-500 mt-1.5 flex items-center gap-1.5">
                          <span className="text-green-400">Currently using:</span>
                          <code className="text-green-300">{humanModelName(originalVal)}</code>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {hasChanges && (
                <div className="rounded-lg border border-yellow-600/50 bg-yellow-900/10 p-3 text-xs text-yellow-400">
                  ⚠ Unsaved changes — deploy to apply
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══ Section C: Swarm Agent Configuration ═══ */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2" style={FONT}>
            🐝 Helper Types
          </CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            When Pearl needs help with big tasks, she can spawn helper agents. You can pick different models for simple vs. complex helpers to balance cost and capability.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          {loadingRoles ? (
            <p className="text-xs text-gray-500">Loading...</p>
          ) : (
            <div className="space-y-2">
              {SWARM_AGENT_TYPES.map(agent => {
                const currentVal = swarmValues[agent.envVar] || '';
                return (
                  <div key={agent.envVar} className="rounded-lg border border-gray-700 bg-gray-900/50 p-3 hover:border-purple-500/40 transition-colors">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg w-8 text-center">{agent.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-medium">{agent.label}</div>
                        <div className="text-xs text-gray-500">{agent.desc}</div>
                      </div>
                    </div>
                    <select
                      value={currentVal}
                      onChange={(e) => setSwarmValue(agent.envVar, e.target.value)}
                      disabled={settingsDisabled}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none disabled:opacity-50"
                      style={FONT}
                    >
                      <option value="">
                        {allModelOptions.length === 0 
                          ? 'No providers connected — enable providers in Connections' 
                          : 'Inherit from Swarm/Sub-Agents role'}
                      </option>
                      {allModelOptions.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                      {currentVal && !allModelOptions.find(o => o.value === currentVal) && (
                        <option value={currentVal}>{currentVal} (custom)</option>
                      )}
                    </select>
                    <div className="text-xs text-gray-600 mt-1">
                      <code className="text-purple-400">{currentVal || 'inherited'}</code>
                      <span className="text-gray-700 ml-2">({agent.envVar})</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Section D: AI Config Advisor ═══ */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white" style={FONT}>🤖 AI Config Advisor</CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Describe your use case and get AI-powered model recommendations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !settingsDisabled && handleGetRecommendations()}
              placeholder="e.g. Voice assistant with coding help and research..."
              disabled={settingsDisabled}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
              style={FONT}
            />
            <button
              onClick={handleGetRecommendations}
              disabled={settingsDisabled || advisorLoading || !useCase.trim()}
              className="rounded-lg border border-purple-500 bg-purple-500/15 px-4 py-2.5 text-sm text-purple-300 hover:bg-purple-500/25 disabled:opacity-50 whitespace-nowrap transition-all"
            >
              {advisorLoading ? 'Thinking...' : 'Get Recommendations'}
            </button>
          </div>

          {advisorError && (
            <p className="text-xs text-red-400">{advisorError}</p>
          )}

          {recommendations && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {recommendations.map((tier) => (
                <div key={tier.tier} className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{tier.icon}</span>
                      <span className="text-sm font-medium text-white">{tier.tier}</span>
                    </div>
                    <span className="text-xs text-gray-400">{tier.cost}</span>
                  </div>
                  <div className="space-y-1">
                    {Object.entries(tier.assignments).map(([envVar, modelId]) => {
                      const role = ALL_ROLES.find(r => r.envVar === envVar);
                      return (
                        <div key={envVar} className="flex items-center gap-2 text-xs">
                          <span>{role?.icon || '•'}</span>
                          <span className="text-gray-500 w-16 shrink-0 truncate">{role?.label || envVar}</span>
                          <code className="text-purple-400 truncate">{modelId}</code>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => applyRecommendation(tier.assignments)}
                    disabled={settingsDisabled}
                    className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:border-purple-500 hover:text-purple-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply This Config
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Section E: Apply Changes & Restart ═══ */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardContent className="py-4 space-y-3" style={FONT}>
          {hasChanges && !settingsDisabled && (
            <div className="rounded-lg border border-yellow-600/50 bg-yellow-900/10 p-3 text-sm text-yellow-300">
              ⚠️ You have unsaved changes. Click below to apply them and restart the gateway.
            </div>
          )}

          <button
            onClick={handleDeploy}
            disabled={settingsDisabled || deploying || !hasChanges}
            className={`w-full rounded-lg px-6 py-4 text-sm font-medium transition-all ${
              hasChanges && !settingsDisabled
                ? 'bg-purple-600 text-white hover:bg-purple-500 active:bg-purple-700'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            } disabled:opacity-50`}
            style={FONT}
          >
            {settingsDisabled 
              ? '🚫 Settings Disabled' 
              : deploying 
                ? '⏳ Applying changes...' 
                : hasChanges 
                  ? '🔄 Apply Changes & Restart Gateway' 
                  : '✓ All Changes Applied'}
          </button>

          {deployStatus && (
            <div className={`rounded-lg p-3 text-sm text-center ${
              deployStatus.includes('❌') || deployStatus.includes('Error') 
                ? 'bg-red-900/20 border border-red-600/30 text-red-300' 
                : deployStatus.includes('⚠️')
                  ? 'bg-yellow-900/20 border border-yellow-600/30 text-yellow-300'
                  : 'bg-green-900/20 border border-green-600/30 text-green-300'
            }`}>
              {deployStatus}
            </div>
          )}

          {!hasChanges && !deployStatus && (
            <p className="text-xs text-gray-500 text-center">
              Make changes above, then click the button to apply them and restart the gateway.
            </p>
          )}

          {/* Manual bot gateway restart */}
          <div className="border-t border-gray-700 pt-3 mt-2">
            <button
              onClick={async () => {
                setDeployStatus('🔄 Restarting bot gateway...');
                try {
                  const res = await fetch('/api/bot/restart', { method: 'POST' });
                  const data = await res.json();
                  if (data.success) {
                    setDeployStatus('✅ Bot gateway restarted. New model settings are now active.');
                  } else {
                    setDeployStatus(`❌ Bot restart failed: ${data.error}`);
                  }
                } catch (err) {
                  setDeployStatus(`❌ Bot restart error: ${err instanceof Error ? err.message : 'Unknown'}`);
                }
                setTimeout(() => setDeployStatus(null), 8000);
              }}
              disabled={settingsDisabled || deploying}
              className="w-full rounded-lg px-4 py-2.5 text-xs font-medium transition-all bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white active:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              style={FONT}
            >
              🔄 Restart Bot Gateway (apply .env changes without full redeploy)
            </button>
            <p className="text-[10px] text-gray-600 text-center mt-1">
              Use this if you changed model settings but voice isn&apos;t using the new model yet.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ModelSettingsPanel;
