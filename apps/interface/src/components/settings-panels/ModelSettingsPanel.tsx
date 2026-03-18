'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  rawEnvValues: Record<string, string>;
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

interface LocalModel {
  name: string;
  modelId: string;
  size: number;
  parameterSize: string | null;
  family: string | null;
  quantization: string | null;
  modifiedAt: string;
}

// ── Model Catalog ──────────────────────────────────────────────────────────

type TagType = '⚡ Fast' | '🧠 Smart' | '👁️ Vision' | '🔧 Tools' | '💻 Code' | '🔬 Reasoning' | '💰 Budget' | '🆓 Free' | '🖥️ Local';

interface CatalogModel {
  value: string;
  label: string;
  description: string;
  recommended?: boolean;
  tags?: TagType[];
}

interface ModelCategory {
  id: string;
  name: string;
  icon: string;
  badge: string;
  badgeColor: string;
  description: string;
  models: CatalogModel[];
}

// Static categories — local models are injected dynamically
const STATIC_CATEGORIES: ModelCategory[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '💎',
    badge: 'Premium • API Key Required',
    badgeColor: 'bg-purple-500/20 text-purple-300',
    description: 'Direct Anthropic API — best pricing, highest quality',
    models: [
      { value: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most intelligent. Best for complex reasoning, coding, creative writing. Slower, expensive.', tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔬 Reasoning', '🔧 Tools'] },
      { value: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5', description: 'Previous-gen flagship. Still extremely capable for hard tasks.', tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔬 Reasoning'] },
      { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', description: 'Great balance of speed and intelligence. Recommended for most tasks.', recommended: true, tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔧 Tools', '⚡ Fast'] },
      { value: 'anthropic/claude-sonnet-4-0', label: 'Claude Sonnet 4.0', description: 'Fast and reliable. Good all-rounder at lower cost.', tags: ['⚡ Fast', '👁️ Vision', '💻 Code', '🔧 Tools'] },
      { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fast and cheap. Good for tool routing, quick tasks, simple questions.', tags: ['⚡ Fast', '👁️ Vision', '🔧 Tools', '💰 Budget'] },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🔑',
    badge: 'Premium • API Key Required',
    badgeColor: 'bg-green-500/20 text-green-300',
    description: 'Direct OpenAI API',
    models: [
      { value: 'openai/gpt-5', label: 'GPT-5', description: 'Latest and most capable OpenAI model.', tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔧 Tools', '🔬 Reasoning'] },
      { value: 'openai/gpt-4.1', label: 'GPT-4.1', description: 'Strong general-purpose model. Good reasoning and coding.', tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔧 Tools'] },
      { value: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Smaller, faster, cheaper GPT-4.1 variant.', tags: ['⚡ Fast', '👁️ Vision', '🔧 Tools', '💰 Budget'] },
      { value: 'openai/o3', label: 'O3', description: 'Reasoning-focused model. Great for math, logic, multi-step problems.', tags: ['🧠 Smart', '🔬 Reasoning'] },
      { value: 'openai/o4-mini', label: 'O4 Mini', description: 'Fast reasoning model. Good balance of speed and capability.', tags: ['⚡ Fast', '🔬 Reasoning', '💰 Budget'] },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    badge: 'Free • Ultra Fast',
    badgeColor: 'bg-yellow-500/20 text-yellow-300',
    description: 'Free tier with blazing fast inference',
    models: [
      { value: 'groq/llama-3.3-70b-versatile', label: 'Llama 3.3 70B', description: 'Large and capable. Free on Groq. Great for most tasks.', tags: ['⚡ Fast', '🆓 Free', '💻 Code'] },
      { value: 'groq/llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', description: 'Extremely fast. Good for quick routing and simple tasks.', tags: ['⚡ Fast', '🆓 Free'] },
      { value: 'groq/deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill', description: 'Reasoning-focused. Free on Groq. Good for complex analysis.', tags: ['⚡ Fast', '🆓 Free', '🔬 Reasoning'] },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '💰',
    badge: 'Pay-per-use • Many Providers',
    badgeColor: 'bg-blue-500/20 text-blue-300',
    description: 'Access 100+ models from every major provider',
    models: [
      // Anthropic via OR
      { value: 'openrouter/anthropic/claude-opus-4.6', label: 'Claude Opus 4.6 (OR)', description: 'Anthropic flagship via OpenRouter.', tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔬 Reasoning', '🔧 Tools'] },
      { value: 'openrouter/anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (OR)', description: 'Balanced Anthropic model via OpenRouter.', tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔧 Tools', '⚡ Fast'] },
      { value: 'openrouter/anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 (OR)', description: 'Fast Anthropic model via OpenRouter.', tags: ['⚡ Fast', '👁️ Vision', '🔧 Tools', '💰 Budget'] },
      // OpenAI via OR
      { value: 'openrouter/openai/gpt-5', label: 'GPT-5 (OR)', description: 'OpenAI flagship via OpenRouter.', tags: ['🧠 Smart', '👁️ Vision', '💻 Code', '🔧 Tools', '🔬 Reasoning'] },
      { value: 'openrouter/openai/o3', label: 'O3 (OR)', description: 'OpenAI reasoning via OpenRouter.', tags: ['🧠 Smart', '🔬 Reasoning'] },
      { value: 'openrouter/openai/o4-mini', label: 'O4 Mini (OR)', description: 'Fast OpenAI reasoning via OpenRouter.', tags: ['⚡ Fast', '🔬 Reasoning', '💰 Budget'] },
      // xAI
      { value: 'openrouter/x-ai/grok-4', label: 'Grok 4', description: 'xAI flagship. Strong reasoning and real-time knowledge.', tags: ['🧠 Smart', '🔬 Reasoning', '💻 Code'] },
      { value: 'openrouter/x-ai/grok-4-fast', label: 'Grok 4 Fast', description: 'Faster Grok variant.', tags: ['⚡ Fast', '🔬 Reasoning', '💻 Code'] },
      { value: 'openrouter/x-ai/grok-3', label: 'Grok 3', description: 'Previous xAI model. Still capable.', tags: ['🧠 Smart', '💻 Code'] },
      { value: 'openrouter/x-ai/grok-3-mini', label: 'Grok 3 Mini', description: 'Lightweight xAI model.', tags: ['⚡ Fast', '💰 Budget'] },
      // Google
      { value: 'openrouter/google/gemini-3-pro-preview', label: 'Gemini 3 Pro', description: 'Google flagship. Strong multimodal capabilities.', tags: ['🧠 Smart', '👁️ Vision', '🔧 Tools', '💻 Code'] },
      { value: 'openrouter/google/gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Fast Google model. Good for voice and quick tasks.', tags: ['⚡ Fast', '👁️ Vision', '🔧 Tools', '💰 Budget'] },
      { value: 'openrouter/google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Previous Google flagship.', tags: ['🧠 Smart', '👁️ Vision', '🔧 Tools'] },
      { value: 'openrouter/google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast previous-gen Google model.', tags: ['⚡ Fast', '👁️ Vision', '💰 Budget'] },
      // DeepSeek
      { value: 'openrouter/deepseek/deepseek-r1', label: 'DeepSeek R1', description: 'Strong reasoning model. Great value.', tags: ['🔬 Reasoning', '💰 Budget'] },
      { value: 'openrouter/deepseek/deepseek-chat', label: 'DeepSeek V3', description: 'General chat model. Very affordable.', tags: ['💰 Budget'] },
      { value: 'openrouter/deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', description: 'Latest DeepSeek general model.', tags: ['💻 Code', '💰 Budget'] },
      // Qwen
      { value: 'openrouter/qwen/qwen3-coder', label: 'Qwen 3 Coder', description: 'Code-specialized Qwen model.', tags: ['💻 Code'] },
      { value: 'openrouter/qwen/qwen3-235b-a22b', label: 'Qwen 3 235B', description: 'Massive Qwen model. Very capable.', tags: ['🧠 Smart', '💻 Code', '🔬 Reasoning'] },
      { value: 'openrouter/qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B', description: 'Large Qwen instruction-tuned model.', tags: ['🧠 Smart', '💻 Code'] },
      // Meta
      { value: 'openrouter/meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', description: 'Meta open-source model. Strong all-rounder.', tags: ['💻 Code', '🆓 Free'] },
      { value: 'openrouter/meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', description: 'Latest Meta model.', tags: ['👁️ Vision', '💻 Code'] },
      // Mistral
      { value: 'openrouter/mistralai/mistral-large', label: 'Mistral Large', description: 'Mistral flagship. Strong European AI.', tags: ['🧠 Smart', '💻 Code'] },
      { value: 'openrouter/mistralai/mistral-nemo', label: 'Mistral Nemo', description: 'Small, fast Mistral model.', tags: ['⚡ Fast', '💰 Budget'] },
      // Others
      { value: 'openrouter/minimax/minimax-m2.1', label: 'MiniMax M2.1', description: 'MiniMax model via OpenRouter.', tags: ['💰 Budget'] },
      { value: 'openrouter/moonshotai/kimi-k2', label: 'Kimi K2', description: 'Moonshot AI model.', tags: ['💻 Code'] },
      { value: 'openrouter/moonshotai/kimi-k2.5', label: 'Kimi K2.5', description: 'Latest Moonshot model.', tags: ['💻 Code', '🧠 Smart'] },
      { value: 'openrouter/z-ai/glm-5', label: 'GLM-5', description: 'Z-AI model. Budget-friendly.', tags: ['💰 Budget'] },
      { value: 'openrouter/z-ai/glm-4.7', label: 'GLM-4.7', description: 'Previous Z-AI model.', tags: ['💰 Budget'] },
      { value: 'openrouter/auto', label: 'Auto (Smart Routing)', description: 'Let OpenRouter pick the best model automatically.' },
    ],
  },
];

// Hardcoded local model descriptions for known models
const LOCAL_MODEL_DESCRIPTIONS: Record<string, string> = {
  'qwen3.5:35b': 'Only 3B active parameters (MoE). Extremely fast locally. Great for tool routing and chat.',
  'qwen3.5:27b': 'Full dense model. Strong coding and reasoning. Slower but more capable than MoE.',
  'qwen3.5:9b': 'Compact but capable. Good balance for local use.',
  'qwen3.5:4b': 'Multimodal with 262K context. Fast and efficient.',
  'qwen3.5:2b': 'Tiny but useful. Fast edge deployment.',
  'qwen3.5:0.8b': 'Ultra-tiny. Prototyping and edge devices only.',
  'qwen2.5:7b': 'Solid Qwen 2.5. Good local workhorse.',
  'qwen2.5:3b': 'Fast Qwen 2.5. Zero cost, decent quality.',
  'llama3.1:8b': 'Meta Llama 3.1. Reliable local model.',
};

// Fallback local models when ollama isn't reachable
const FALLBACK_LOCAL_MODELS: CatalogModel[] = [
  { value: 'ollama/qwen3.5:35b', label: 'Qwen 3.5 35B (MoE)', description: LOCAL_MODEL_DESCRIPTIONS['qwen3.5:35b'] || 'Local model', recommended: true, tags: ['⚡ Fast', '🔧 Tools', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/qwen3.5:27b', label: 'Qwen 3.5 27B', description: LOCAL_MODEL_DESCRIPTIONS['qwen3.5:27b'] || 'Local model', tags: ['🧠 Smart', '💻 Code', '🔬 Reasoning', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/qwen3.5:9b', label: 'Qwen 3.5 9B', description: LOCAL_MODEL_DESCRIPTIONS['qwen3.5:9b'] || 'Local model', tags: ['⚡ Fast', '💻 Code', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/qwen3.5:4b', label: 'Qwen 3.5 4B', description: LOCAL_MODEL_DESCRIPTIONS['qwen3.5:4b'] || 'Local model', tags: ['⚡ Fast', '👁️ Vision', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/qwen3.5:2b', label: 'Qwen 3.5 2B', description: LOCAL_MODEL_DESCRIPTIONS['qwen3.5:2b'] || 'Local model', tags: ['⚡ Fast', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/qwen3.5:0.8b', label: 'Qwen 3.5 0.8B', description: LOCAL_MODEL_DESCRIPTIONS['qwen3.5:0.8b'] || 'Local model', tags: ['⚡ Fast', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/qwen2.5:7b', label: 'Qwen 2.5 7B', description: LOCAL_MODEL_DESCRIPTIONS['qwen2.5:7b'] || 'Local model', tags: ['⚡ Fast', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/qwen2.5:3b', label: 'Qwen 2.5 3B', description: LOCAL_MODEL_DESCRIPTIONS['qwen2.5:3b'] || 'Local model', tags: ['⚡ Fast', '🆓 Free', '🖥️ Local'] },
  { value: 'ollama/llama3.1:8b', label: 'Llama 3.1 8B', description: LOCAL_MODEL_DESCRIPTIONS['llama3.1:8b'] || 'Local model', tags: ['⚡ Fast', '🆓 Free', '🖥️ Local'] },
];

// Also keep backward-compat non-prefixed local model values in PRIMARY_MODELS
const LEGACY_LOCAL_VALUES = [
  'qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.5:4b', 'qwen3.5:9b', 'qwen3.5:27b', 'qwen3.5:35b',
  'qwen2.5:0.5b', 'qwen2.5:1.5b', 'qwen2.5:3b', 'qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5:32b',
  'qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'qwen2.5-coder:32b',
  'qwen3:0.6b', 'qwen3:1.7b', 'qwen3:4b', 'qwen3:8b', 'qwen3:14b', 'qwen3:30b', 'qwen3:32b',
  'llama3.1:8b',
];

// Build flat PRIMARY_MODELS for backward compat (used by role selectors and deploy)
const PRIMARY_MODELS = [
  ...STATIC_CATEGORIES.flatMap(cat => cat.models.map(m => ({
    value: m.value,
    label: `${cat.icon} ${m.label}`,
    provider: cat.name,
  }))),
  ...FALLBACK_LOCAL_MODELS.map(m => ({
    value: m.value,
    label: `🖥️ ${m.label}`,
    provider: 'Local (Ollama)',
  })),
  // Legacy local values (without ollama/ prefix) for backward compat
  ...LEGACY_LOCAL_VALUES.map(v => ({
    value: v,
    label: `🖥️ ${v} (Local)`,
    provider: 'Local (Ollama)',
  })),
];

// ── Constants ──────────────────────────────────────────────────────────────

// All 8 bot model roles
const ALL_ROLES: { key: string; envVar: string; label: string; desc: string; longDesc: string; icon: string; api: 'preset' | 'settings' }[] = [
  {
    key: 'fast', envVar: 'BOT_FAST_MODEL', label: 'Quick Replies', icon: '⚡', api: 'preset',
    desc: 'Instant voice acknowledgments while Pearl works on your request',
    longDesc: 'When you ask Pearl to do something that takes time, this fast model lets her say "Got it, working on that..." instantly. Use the fastest model you have here.',
  },
  {
    key: 'escalation', envVar: 'BOT_ESCALATION_MODEL', label: 'Heavy Lifting', icon: '🧠', api: 'preset',
    desc: 'For complex problems, math, logic, and multi-step reasoning',
    longDesc: 'When Pearl encounters something really challenging — complex code, deep research, math, logic, or multi-step planning — she automatically switches to this more powerful model for extra brainpower.',
  },
  {
    key: 'vision', envVar: 'BOT_VISION_MODEL', label: 'Looking at Images', icon: '👁️', api: 'settings',
    desc: 'When Pearl needs to see and understand pictures, screenshots, or camera feeds',
    longDesc: "This model powers Pearl's visual understanding — analyzing images, screenshots, camera feeds during video calls.",
  },
  {
    key: 'tools', envVar: 'BOT_TOOLS_MODEL', label: 'Using Tools', icon: '🔧', api: 'settings',
    desc: 'Running commands, calling APIs, and handling structured tasks',
    longDesc: 'When Pearl needs to use tools — running shell commands, calling APIs, working with structured data.',
  },
  {
    key: 'swarm', envVar: 'BOT_SWARM_MODEL', label: 'Helper Agents', icon: '🐝', api: 'settings',
    desc: 'Background workers Pearl spawns to help with big tasks',
    longDesc: "When Pearl needs help, she spawns mini-versions of herself to work in parallel. This model powers those helper agents.",
  },
];

const SWARM_AGENT_TYPES: { key: string; envVar: string; label: string; icon: string; desc: string }[] = [
  { key: 'regular', envVar: 'BOT_SWARM_REGULAR_MODEL', label: 'Simple Helpers', icon: '🤖', desc: 'For quick tasks like reading files, checking messages' },
  { key: 'skilled', envVar: 'BOT_SWARM_SKILLED_MODEL', label: 'Expert Helpers', icon: '🧑‍💻', desc: 'For complex work like writing code, deep research' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function humanModelName(modelId: string): string {
  // Check all categories
  for (const cat of STATIC_CATEGORIES) {
    const found = cat.models.find(m => m.value === modelId);
    if (found) return found.label;
  }
  // Check fallback locals
  const local = FALLBACK_LOCAL_MODELS.find(m => m.value === modelId);
  if (local) return local.label;
  // Strip prefixes for display
  return modelId.replace(/^(openrouter|anthropic|openai|groq|ollama)\//, '');
}

function formatBytes(bytes: number): string {
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)}MB`;
  return `${(bytes / 1e9).toFixed(1)}GB`;
}

// ── CategoryModelPicker Component ──────────────────────────────────────────

function CategoryModelPicker({
  categories,
  value,
  onChange,
  disabled,
}: {
  categories: ModelCategory[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Find which category contains the current value
  const currentModel = categories.flatMap(c => c.models).find(m => m.value === value);
  const currentCategory = categories.find(c => c.models.some(m => m.value === value));

  const filteredCategories = search.trim()
    ? categories.map(cat => ({
        ...cat,
        models: cat.models.filter(m =>
          m.label.toLowerCase().includes(search.toLowerCase()) ||
          m.description.toLowerCase().includes(search.toLowerCase()) ||
          m.value.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(cat => cat.models.length > 0)
    : categories;

  return (
    <div className="space-y-2">
      {/* Current selection display */}
      {value && currentModel && (
        <div className="flex items-center gap-3 rounded-lg border border-purple-500/40 bg-purple-500/5 px-4 py-3">
          <span className="text-lg">{currentCategory?.icon || '🧠'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white font-medium flex items-center gap-2">
              {currentModel.label}
              {currentModel.recommended && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400">★ Recommended</span>
              )}
            </div>
            <div className="text-xs text-gray-400">{currentModel.description}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400">Active</span>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models..."
          disabled={disabled}
          className="w-full rounded-lg border border-gray-700 bg-gray-900/80 px-4 py-2.5 pl-9 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
          style={FONT}
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
      </div>

      {/* Categories */}
      <div className="space-y-1.5">
        {filteredCategories.map(category => {
          const isExpanded = expandedCategory === category.id || !!search.trim();
          const hasSelected = category.models.some(m => m.value === value);

          return (
            <div
              key={category.id}
              className={`rounded-lg border transition-all ${
                hasSelected ? 'border-purple-500/30 bg-purple-500/5' : 'border-gray-700/50 bg-gray-900/30'
              }`}
            >
              {/* Category header */}
              <button
                type="button"
                onClick={() => setExpandedCategory(isExpanded && !search.trim() ? null : category.id)}
                disabled={disabled}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors disabled:opacity-50"
              >
                <span className="text-xl">{category.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium flex items-center gap-2">
                    {category.name}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${category.badgeColor}`}>
                      {category.badge}
                    </span>
                    {hasSelected && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
                        ● Selected
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{category.description}</div>
                </div>
                <span className="text-gray-500 text-xs shrink-0">
                  {category.models.length} model{category.models.length !== 1 ? 's' : ''}
                  <span className="ml-2">{isExpanded ? '▾' : '▸'}</span>
                </span>
              </button>

              {/* Model list */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-1">
                  {category.models.map(model => {
                    const isSelected = model.value === value;
                    return (
                      <button
                        key={model.value}
                        type="button"
                        onClick={() => { onChange(model.value); setSearch(''); }}
                        disabled={disabled}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all disabled:opacity-50 ${
                          isSelected
                            ? 'bg-purple-500/15 border border-purple-500/40 ring-1 ring-purple-500/20'
                            : 'hover:bg-white/[0.03] border border-transparent'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white flex items-center gap-2">
                            {model.label}
                            {model.recommended && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400">★ Recommended</span>
                            )}
                            {isSelected && (
                              <span className="text-green-400 text-xs">✓</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{model.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tag Colors & Utilities ──────────────────────────────────────────────────

const TAG_COLORS: Record<TagType, string> = {
  '⚡ Fast': 'bg-yellow-400/20 text-yellow-300',
  '🧠 Smart': 'bg-purple-400/20 text-purple-300',
  '👁️ Vision': 'bg-cyan-400/20 text-cyan-300',
  '🔧 Tools': 'bg-orange-400/20 text-orange-300',
  '💻 Code': 'bg-green-400/20 text-green-300',
  '🔬 Reasoning': 'bg-blue-400/20 text-blue-300',
  '💰 Budget': 'bg-gray-400/20 text-gray-300',
  '🆓 Free': 'bg-emerald-400/20 text-emerald-300',
  '🖥️ Local': 'bg-pink-400/20 text-pink-300',
};

// Known local model tags for dynamically loaded models
const LOCAL_MODEL_TAGS: Record<string, TagType[]> = {
  'qwen3.5:35b': ['⚡ Fast', '🔧 Tools', '🆓 Free', '🖥️ Local'],
  'qwen3.5:27b': ['🧠 Smart', '💻 Code', '🔬 Reasoning', '🆓 Free', '🖥️ Local'],
  'qwen3.5:9b': ['⚡ Fast', '💻 Code', '🆓 Free', '🖥️ Local'],
  'qwen3.5:4b': ['⚡ Fast', '👁️ Vision', '🆓 Free', '🖥️ Local'],
  'qwen3.5:2b': ['⚡ Fast', '🆓 Free', '🖥️ Local'],
  'qwen3.5:0.8b': ['⚡ Fast', '🆓 Free', '🖥️ Local'],
  'qwen2.5:7b': ['⚡ Fast', '🆓 Free', '🖥️ Local'],
  'qwen2.5:3b': ['⚡ Fast', '🆓 Free', '🖥️ Local'],
  'llama3.1:8b': ['⚡ Fast', '🆓 Free', '🖥️ Local'],
};

// Role hints and filters
const ROLE_HINTS: Record<string, { hint: string; preferTags: TagType[]; requireTags?: TagType[] }> = {
  BOT_FAST_MODEL: { hint: 'Best with ⚡ Fast models', preferTags: ['⚡ Fast'] },
  BOT_ESCALATION_MODEL: { hint: 'Best with 🧠 Smart + 🔬 Reasoning models', preferTags: ['🧠 Smart', '🔬 Reasoning'] },
  BOT_THINKING_MODEL: { hint: 'Best with 🔬 Reasoning models', preferTags: ['🔬 Reasoning'] },
  BOT_VISION_MODEL: { hint: 'Requires 👁️ Vision models', preferTags: ['👁️ Vision'], requireTags: ['👁️ Vision'] },
  BOT_TOOLS_MODEL: { hint: 'Best with 🔧 Tools models', preferTags: ['🔧 Tools'] },
  BOT_SWARM_MODEL: { hint: 'Best with ⚡ Fast + 💰 Budget models', preferTags: ['⚡ Fast', '💰 Budget'] },
};

function TagPill({ tag }: { tag: TagType }) {
  return (
    <span className={`inline-flex items-center text-[9px] leading-none px-1.5 py-0.5 rounded-full whitespace-nowrap ${TAG_COLORS[tag] || 'bg-gray-500/20 text-gray-400'}`}>
      {tag}
    </span>
  );
}

// ── Rich Model Select (for role selectors) ─────────────────────────────────

function RichModelSelect({
  categories,
  value,
  onChange,
  disabled,
  placeholder,
  roleEnvVar,
}: {
  categories: ModelCategory[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  roleEnvVar?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState<TagType | null>(null);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const roleHint = roleEnvVar ? ROLE_HINTS[roleEnvVar] : undefined;
  const requireTags = roleHint?.requireTags;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
        setActiveTagFilter(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [isOpen]);

  // Filter categories
  const filteredCategories = categories.map(cat => {
    let models = cat.models;
    // Hard filter by required tags (e.g. vision role)
    if (requireTags?.length) {
      models = models.filter(m => requireTags.every(rt => m.tags?.includes(rt)));
    }
    // Tag filter
    if (activeTagFilter) {
      models = models.filter(m => m.tags?.includes(activeTagFilter));
    }
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      models = models.filter(m =>
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.value.toLowerCase().includes(q) ||
        m.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    return { ...cat, models };
  }).filter(cat => cat.models.length > 0);

  // Sort: preferred tags first within each category
  const preferTags = roleHint?.preferTags;
  const sortedCategories = filteredCategories.map(cat => {
    if (!preferTags?.length) return cat;
    const sorted = [...cat.models].sort((a, b) => {
      const aScore = preferTags.filter(t => a.tags?.includes(t)).length;
      const bScore = preferTags.filter(t => b.tags?.includes(t)).length;
      return bScore - aScore;
    });
    return { ...cat, models: sorted };
  });

  // Find current model
  const allModels = categories.flatMap(c => c.models);
  const currentModel = allModels.find(m => m.value === value);
  const currentCategory = categories.find(c => c.models.some(m => m.value === value));

  // Collect all available tags for filter chips
  const availableTags = Array.from(new Set(
    filteredCategories.flatMap(c => c.models.flatMap(m => m.tags || []))
  )) as TagType[];

  return (
    <div ref={containerRef} className="relative" style={FONT}>
      {/* Role hint */}
      {roleHint && (
        <div className="text-[10px] text-gray-500 mb-1.5 flex items-center gap-1">
          <span>💡</span>
          <span>{roleHint.hint}</span>
        </div>
      )}

      {/* Collapsed trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-all disabled:opacity-50 ${
          isOpen ? 'border-purple-500 bg-gray-900 ring-1 ring-purple-500/30' : 'border-gray-700 bg-gray-900 hover:border-gray-600'
        }`}
      >
        {value && currentModel ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs shrink-0">{currentCategory?.icon || '🧠'}</span>
            <span className="text-white truncate">{currentModel.label}</span>
            <div className="flex items-center gap-1 shrink-0 overflow-hidden">
              {currentModel.tags?.slice(0, 3).map(t => <TagPill key={t} tag={t} />)}
              {(currentModel.tags?.length || 0) > 3 && <span className="text-[9px] text-gray-500">+{(currentModel.tags?.length || 0) - 3}</span>}
            </div>
            <span className="text-gray-500 ml-auto shrink-0">{isOpen ? '▾' : '▸'}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">{placeholder || 'Not set (use default)'}</span>
            <span className="text-gray-500">{isOpen ? '▾' : '▸'}</span>
          </div>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full max-h-[60vh] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50 flex flex-col">
          {/* Search + clear option */}
          <div className="p-2 border-b border-gray-800 space-y-2 shrink-0">
            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 pl-7 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                style={FONT}
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-[10px]">🔍</span>
            </div>
            {/* Tag filter chips */}
            {availableTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {availableTags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveTagFilter(activeTagFilter === tag ? null : tag)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-full transition-all ${
                      activeTagFilter === tag
                        ? TAG_COLORS[tag] + ' ring-1 ring-white/20'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear selection option */}
          <button
            type="button"
            onClick={() => { onChange(''); setIsOpen(false); setSearch(''); setActiveTagFilter(null); }}
            className="w-full px-3 py-2 text-xs text-gray-500 text-left hover:bg-white/[0.03] border-b border-gray-800 shrink-0"
          >
            ✕ {placeholder || 'Not set (use default)'}
          </button>

          {/* Model list */}
          <div className="overflow-y-auto flex-1">
            {sortedCategories.map(cat => {
              const catExpanded = expandedCat === cat.id || !!search.trim() || !!activeTagFilter;
              return (
                <div key={cat.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedCat(catExpanded && !search.trim() && !activeTagFilter ? null : cat.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] sticky top-0 bg-gray-900 z-10 border-b border-gray-800/50"
                  >
                    <span className="text-sm">{cat.icon}</span>
                    <span className="text-xs text-gray-300 font-medium flex-1">{cat.name}</span>
                    <span className="text-[10px] text-gray-600">{cat.models.length} {catExpanded ? '▾' : '▸'}</span>
                  </button>
                  {catExpanded && cat.models.map(model => {
                    const isSelected = model.value === value;
                    const isPreferred = preferTags?.some(t => model.tags?.includes(t));
                    return (
                      <button
                        key={model.value}
                        type="button"
                        onClick={() => { onChange(model.value); setIsOpen(false); setSearch(''); setActiveTagFilter(null); }}
                        className={`w-full px-3 py-2 text-left transition-all ${
                          isSelected
                            ? 'bg-purple-500/15 border-l-2 border-purple-500'
                            : isPreferred
                            ? 'bg-purple-500/5 hover:bg-purple-500/10 border-l-2 border-transparent'
                            : 'hover:bg-white/[0.03] border-l-2 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs text-white truncate">{model.label}</span>
                              {model.recommended && (
                                <span className="text-[9px] px-1 py-0 rounded-full bg-teal-500/20 text-teal-400">★</span>
                              )}
                              {isSelected && <span className="text-green-400 text-[10px]">✓</span>}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {model.tags?.map(t => <TagPill key={t} tag={t} />)}
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{model.description}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {sortedCategories.length === 0 && (
              <div className="px-3 py-4 text-xs text-gray-500 text-center">No models match your filters</div>
            )}
          </div>
        </div>
      )}

      {/* Custom value fallback */}
      {value && !currentModel && (
        <div className="text-[10px] text-gray-500 mt-1">Custom: <code className="text-gray-400">{value}</code></div>
      )}
    </div>
  );
}

// Keep FlatModelSelect as fallback for swarm selectors
function FlatModelSelect({
  categories,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  categories: ModelCategory[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none disabled:opacity-50"
      style={FONT}
    >
      <option value="">{placeholder || 'Not set (use default)'}</option>
      {categories.map(cat => (
        <optgroup key={cat.id} label={`${cat.icon} ${cat.name} — ${cat.badge}`}>
          {cat.models.map(m => (
            <option key={m.value} value={m.value}>
              {m.label}{m.recommended ? ' ★' : ''}{m.tags?.length ? ` [${m.tags.join(', ')}]` : ''}
            </option>
          ))}
        </optgroup>
      ))}
      {/* If current value not in any category, show it as custom */}
      {value && !categories.flatMap(c => c.models).find(m => m.value === value) && (
        <option value={value}>{value} (custom)</option>
      )}
    </select>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function ModelSettingsPanel() {
  const [settingsDisabled, setSettingsDisabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pearl_settings_disabled') === 'true';
    }
    return false;
  });

  useEffect(() => {
    const handleStorageChange = () => {
      if (typeof window !== 'undefined') {
        setSettingsDisabled(localStorage.getItem('pearl_settings_disabled') === 'true');
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      const interval = setInterval(handleStorageChange, 500);
      return () => { window.removeEventListener('storage', handleStorageChange); clearInterval(interval); };
    }
  }, []);

  // Pearl Mind Primary
  const [openclawModel, setOpenclawModel] = useState('');
  const [openclawStatus, setOpenclawStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [savingPrimary, setSavingPrimary] = useState(false);
  const [primaryMessage, setPrimaryMessage] = useState<string | null>(null);

  // LLM mode
  const [isOpenclawSession, setIsOpenclawSession] = useState(false);

  // Bot model roles
  const [modelCatalog, setModelCatalog] = useState<Record<string, ModelInfo>>({});
  const [roleValues, setRoleValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  // Swarm
  const [swarmValues, setSwarmValues] = useState<Record<string, string>>({});
  const [originalSwarmValues, setOriginalSwarmValues] = useState<Record<string, string>>({});

  // Recommended
  const [recommendedApplied, setRecommendedApplied] = useState(false);

  // AI Config Advisor
  const [useCase, setUseCase] = useState('');
  const useCaseRef = useRef<HTMLInputElement>(null);
  const [recommendations, setRecommendations] = useState<RecommendationTier[] | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);

  // Expanded role
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  // Provider status
  const [providerStatus, setProviderStatus] = useState<Record<string, { enabled: boolean; connected: boolean }>>({});

  // Local models from ollama
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [localAvailable, setLocalAvailable] = useState(false);

  // Lab mode
  const [labActive, setLabActive] = useState(false);
  const [labLoading, setLabLoading] = useState(false);
  const [labSnapshotTime, setLabSnapshotTime] = useState<string | null>(null);
  const [labMessage, setLabMessage] = useState<string | null>(null);

  // ── Build categories with dynamic local models ──
  const categories: ModelCategory[] = (() => {
    const localCat: ModelCategory = {
      id: 'local',
      name: 'Local Models (On This Device)',
      icon: '🖥️',
      badge: localAvailable ? 'Local • Free • Private' : 'Ollama Not Detected',
      badgeColor: localAvailable ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-gray-400',
      description: localAvailable
        ? `${localModels.length} model${localModels.length !== 1 ? 's' : ''} installed — free, private, no API key needed`
        : 'Install Ollama to run models locally for free',
      models: localAvailable && localModels.length > 0
        ? localModels.map(m => ({
            value: m.modelId,
            label: `${m.name}${m.parameterSize ? ` (${m.parameterSize})` : ''}`,
            description: LOCAL_MODEL_DESCRIPTIONS[m.name] || `Local ${m.family || ''} model${m.size ? ' • ' + formatBytes(m.size) : ''}`,
            recommended: m.name === 'qwen3.5:35b',
            tags: LOCAL_MODEL_TAGS[m.name] || ['🆓 Free', '🖥️ Local'] as TagType[],
          }))
        : FALLBACK_LOCAL_MODELS,
    };
    return [localCat, ...STATIC_CATEGORIES];
  })();

  // ── Load local models ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/bot/local-models', { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const data = await res.json();
          setLocalAvailable(data.available === true);
          setLocalModels(data.models || []);
        }
      } catch {
        // Ollama not available — use fallbacks
      }
    })();
  }, []);

  // ── Load provider status ──
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
      } catch {}
    })();
  }, []);

  // ── Load LLM mode ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/bot/llm-mode', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          setIsOpenclawSession(data.isOpenclawSession === true);
        }
      } catch {}
    })();
  }, []);

  // ── Load OpenClaw primary ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/openclaw-config', { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const config = await res.json();
          setOpenclawModel(config?.agents?.defaults?.model?.primary || '');
          setOpenclawStatus('connected');
        } else {
          // Retry once before giving up
          const retry = await fetch('/api/openclaw-config', { signal: AbortSignal.timeout(10000) }).catch(() => null);
          if (retry?.ok) {
            const config = await retry.json();
            setOpenclawModel(config?.agents?.defaults?.model?.primary || '');
            setOpenclawStatus('connected');
          } else {
            setOpenclawStatus('disconnected');
          }
        }
      } catch {
        // Retry once on timeout
        try {
          const retry = await fetch('/api/openclaw-config', { signal: AbortSignal.timeout(10000) });
          if (retry.ok) {
            const config = await retry.json();
            setOpenclawModel(config?.agents?.defaults?.model?.primary || '');
            setOpenclawStatus('connected');
            return;
          }
        } catch { /* fall through */ }
        setOpenclawStatus('disconnected');
      }
    })();
  }, []);

  // ── Load bot role models ──
  const loadRoles = useCallback(async () => {
    try {
      const settingsRes = await fetch('/api/bot/model-settings');
      const vals: Record<string, string> = {};

      if (settingsRes.ok) {
        const data: ModelSettingsResponse = await settingsRes.json();
        setModelCatalog(data.availableModels);

        // Use rawEnvValues as the single source of truth (reads directly from .env)
        if (data.rawEnvValues) {
          for (const [envVar, value] of Object.entries(data.rawEnvValues)) {
            if (value) vals[envVar] = value;
          }
        } else {
          // Fallback to mapped config for older API versions
          for (const [taskKey, modelKey] of Object.entries(data.config)) {
            const model = data.availableModels[modelKey];
            const taskType = data.taskTypes[taskKey];
            if (taskType && model) {
              vals[taskType.envVar] = model.modelId;
            }
          }
        }
      }

      setRoleValues(vals);
      setOriginalValues(vals);
      setSwarmValues({});
      setOriginalSwarmValues({});
    } catch {} finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  // ── Load lab mode ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/bot/lab-mode', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          setLabActive(data.active === true);
          setLabSnapshotTime(data.snapshotTime || null);
        }
      } catch {}
    })();
  }, []);

  // ── Handlers ──

  const handlePrimaryModelChange = async (model: string) => {
    setSavingPrimary(true);
    setPrimaryMessage(null);
    try {
      const res = await fetch('/api/openclaw-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: {
            agents: {
              defaults: { model: { primary: model } },
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

  const GOLD_STANDARD: Record<string, string> = {
    BOT_FAST_MODEL: 'anthropic/claude-haiku-4-5',
    BOT_VOICE_MODEL: 'google/gemini-3-flash-preview',
    BOT_TOOLS_MODEL: 'anthropic/claude-haiku-4-5',
    BOT_THINKING_MODEL: 'anthropic/claude-sonnet-4-5',
    BOT_ESCALATION_MODEL: 'anthropic/claude-opus-4-6',
    BOT_SWARM_MODEL: 'anthropic/claude-opus-4-6',
    BOT_VISION_MODEL: 'google/gemini-3.1-pro-preview',
  };

  const handleApplyRecommendedMind = async () => {
    setRoleValues(prev => ({ ...prev, ...GOLD_STANDARD }));
    await handlePrimaryModelChange('anthropic/claude-haiku-4-5');
    setRecommendedApplied(true);
    setTimeout(() => setRecommendedApplied(false), 4000);
  };

  const hasChanges =
    JSON.stringify(roleValues) !== JSON.stringify(originalValues) ||
    JSON.stringify(swarmValues) !== JSON.stringify(originalSwarmValues);

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployStatus('Saving model settings...');
    try {
      const allEnvVars: Record<string, string> = {};
      for (const role of ALL_ROLES) {
        if (roleValues[role.envVar]) {
          allEnvVars[role.envVar] = roleValues[role.envVar];
        }
      }
      // Sync: write Heavy Lifting value to both BOT_ESCALATION_MODEL and BOT_THINKING_MODEL
      if (allEnvVars['BOT_ESCALATION_MODEL']) {
        allEnvVars['BOT_THINKING_MODEL'] = allEnvVars['BOT_ESCALATION_MODEL'];
      }
      for (const agent of SWARM_AGENT_TYPES) {
        if (swarmValues[agent.envVar]) {
          allEnvVars[agent.envVar] = swarmValues[agent.envVar];
        }
      }

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

      const openclawModelVal = roleValues['BOT_OPENCLAW_MODEL'];
      if (openclawModelVal) {
        setDeployStatus('Updating OpenClaw primary model...');
        const configRes = await fetch('/api/openclaw-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patch: {
              agents: {
                defaults: { model: { primary: openclawModelVal } },
                list: [{ id: 'voice', model: { primary: openclawModelVal } }],
              },
            },
          }),
        });
        if (!configRes.ok) {
          setDeployStatus('⚠️ Saved to .env, but OpenClaw config update failed.');
          setTimeout(() => setDeployStatus(null), 10000);
          return;
        }
      }

      setDeployStatus('Restarting gateways...');
      try { await fetch('/api/bot/restart', { method: 'POST' }); } catch {}
      await new Promise(resolve => setTimeout(resolve, 2000));

      setDeployStatus('✅ All changes applied!');
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
    const currentUseCase = useCaseRef.current?.value || useCase;
    if (!currentUseCase.trim()) return;
    setAdvisorLoading(true);
    setAdvisorError(null);
    setRecommendations(null);

    const prompt = `You are a PearlOS model configuration advisor. The user wants to configure their AI assistant for: "${currentUseCase}"

Recommend optimal model assignments for these roles. Return ONLY valid JSON array with 3 tiers:

Roles: BOT_FAST_MODEL, BOT_OPENCLAW_MODEL, BOT_ESCALATION_MODEL, BOT_VOICE_MODEL, BOT_TOOLS_MODEL, BOT_SWARM_MODEL, BOT_THINKING_MODEL

Available models: groq/llama-3.3-70b-versatile, groq/llama-3.1-8b-instant, anthropic/claude-sonnet-4-5, anthropic/claude-haiku-4-5, anthropic/claude-opus-4-6, openai/gpt-5, openai/o3, openai/gpt-4.1, openrouter/google/gemini-3-pro-preview, openrouter/google/gemini-3-flash-preview, openrouter/deepseek/deepseek-r1, openrouter/x-ai/grok-4

Return: [{"tier":"Budget","icon":"💰","cost":"~$5-15/mo","assignments":{...}},{"tier":"Balanced","icon":"⚖️","cost":"~$30-60/mo","assignments":{...}},{"tier":"Premium","icon":"🚀","cost":"~$100-200/mo","assignments":{...}}]
ONLY return the JSON array.`;

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
      setAdvisorError(`Failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setAdvisorLoading(false);
    }
  };

  const applyRecommendation = (assignments: Record<string, string>) => {
    setRoleValues(prev => ({ ...prev, ...assignments }));
  };

  const handleLabToggle = async () => {
    setLabLoading(true);
    setLabMessage(null);
    try {
      const action = labActive ? 'deactivate' : 'activate';
      const res = await fetch('/api/bot/lab-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setLabActive(data.active === true);
        setLabSnapshotTime(data.snapshotTime || null);
        setLabMessage(action === 'activate' ? '✓ Config snapshotted. Experiment freely!' : '✓ Config restored.');
        if (action === 'deactivate') loadRoles();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setLabMessage(`❌ ${err.error}`);
      }
    } catch {
      setLabMessage('❌ Failed to toggle lab mode');
    } finally {
      setLabLoading(false);
      setTimeout(() => setLabMessage(null), 5000);
    }
  };

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* ═══ Lab Mode ═══ */}
      <div
        className="rounded-lg border p-4"
        style={{
          ...FONT,
          borderColor: labActive ? 'rgba(245,158,11,0.4)' : 'rgba(107,114,128,0.4)',
          background: labActive
            ? 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.04) 100%)'
            : 'rgba(31,41,55,0.5)',
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: labActive ? 'rgba(245,158,11,0.2)' : 'rgba(107,114,128,0.15)' }}>
              <span className="text-xl">{labActive ? '🧪' : '🔬'}</span>
            </div>
            <div>
              <div className="text-sm font-medium flex items-center gap-2" style={{ color: labActive ? '#fbbf24' : '#d1d5db' }}>
                Lab Mode
                {labActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">ACTIVE</span>}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {labActive ? 'Experimenting — your saved config can be restored instantly' : 'Experiment safely. Config is snapshotted.'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {labActive && (
              <button onClick={handleLabToggle} disabled={labLoading || settingsDisabled}
                className="px-3 py-1.5 rounded-lg text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50" style={FONT}>
                {labLoading ? '...' : 'Revert'}
              </button>
            )}
            <button onClick={handleLabToggle} disabled={labLoading || settingsDisabled}
              className="relative w-11 h-6 rounded-full transition-colors"
              style={{ background: labActive ? 'rgba(245,158,11,0.5)' : 'rgba(75,85,99,0.5)' }}>
              <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                style={{ left: labActive ? '22px' : '2px' }} />
            </button>
          </div>
        </div>
        {labMessage && <div className={`mt-2 text-xs ${labMessage.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{labMessage}</div>}
      </div>

      {/* ═══ Settings Disabled Banner ═══ */}
      {settingsDisabled && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4" style={FONT}>
          <div className="flex items-center gap-3">
            <span className="text-xl">🚫</span>
            <div>
              <div className="text-sm text-orange-300 font-medium">Settings Disabled — Read-Only</div>
              <div className="text-xs text-gray-400 mt-1">Re-enable in Connections settings.</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Active Model Banner ═══ */}
      {isOpenclawSession && openclawModel && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 flex items-center gap-3" style={FONT}>
          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
            <span className="text-sm">🧠</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-purple-300 font-medium">Active: {humanModelName(openclawModel)}</div>
            <div className="text-xs text-gray-400">All Pearl sessions — voice, Discord, Telegram, webchat</div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400">Live</span>
          </div>
        </div>
      )}

      {/* ═══ PearlOS Recommended Mind ═══ */}
      <button
        onClick={handleApplyRecommendedMind}
        disabled={settingsDisabled || savingPrimary}
        className="w-full rounded-lg p-4 text-left transition-all disabled:opacity-50 hover:scale-[1.005] active:scale-[0.995]"
        style={{
          ...FONT,
          background: 'linear-gradient(135deg, rgba(20,30,40,0.95) 0%, rgba(30,40,55,0.95) 100%)',
          border: '2px solid transparent',
          borderImage: 'linear-gradient(135deg, #2dd4bf, #a78bfa, #2dd4bf) 1',
        }}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(45,212,191,0.2), rgba(167,139,250,0.2))' }}>
            <span className="text-2xl">🐚</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-teal-300 flex items-center gap-2">
              PearlOS Recommended Mind
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400 font-normal">GOLD STANDARD</span>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              Optimal config — Haiku 4.5 primary, Gemini 3 Flash voice, Opus 4.6 escalation
            </div>
          </div>
          <div className="text-teal-400 text-xl shrink-0">→</div>
        </div>
        {recommendedApplied && (
          <div className="mt-2 text-xs text-green-400">✓ Gold standard applied! Deploy below to activate.</div>
        )}
      </button>

      {/* ═══ Section A: Pearl Mind Primary — Categorized Picker ═══ */}
      <Card className={`border-gray-700 bg-gray-800 ${isOpenclawSession ? 'ring-1 ring-purple-500/30' : ''}`} style={FONT}>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-white" style={FONT}>
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <span className="text-xl">🧠</span>
            </div>
            <div>
              <div className="font-medium flex items-center gap-2">
                Pearl Mind — Primary
                {isOpenclawSession && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-normal">ACTIVE</span>}
              </div>
              <p className="text-sm text-gray-400 font-normal">
                The ONE model controlling all Pearl responses
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

          <CategoryModelPicker
            categories={categories}
            value={openclawModel}
            onChange={handlePrimaryModelChange}
            disabled={settingsDisabled || openclawStatus !== 'connected' || savingPrimary}
          />

          {isOpenclawSession && (
            <div className="text-xs text-purple-400/70 bg-purple-500/5 rounded-lg px-3 py-2">
              ✦ Changing this model takes effect immediately for all new Pearl responses.
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
          <CardTitle className="text-white flex items-center gap-2" style={FONT}>🎯 What Models Pearl Uses</CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Different AI models for different tasks — faster models for quick tasks, smarter for hard problems.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" style={FONT}>
          {loadingRoles ? (
            <p className="text-xs text-gray-500">Loading configuration...</p>
          ) : (
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
                      <div className="flex items-center gap-3 mb-2 cursor-pointer select-none"
                        onClick={() => setExpandedRole(isExpanded ? null : role.envVar)}>
                        <span className="text-lg w-8 text-center">{role.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white font-medium flex items-center gap-2">
                            {role.label}
                            {isActive && (
                              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />Active
                              </span>
                            )}
                            {isChanged && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Changed</span>}
                          </div>
                          <div className="text-xs text-gray-500">{role.desc}</div>
                        </div>
                        <span className="text-xs text-gray-600">{isExpanded ? '▾' : '▸'}</span>
                      </div>
                      {isExpanded && <p className="text-xs text-gray-400 mb-2 ml-11 leading-relaxed">{role.longDesc}</p>}

                      <RichModelSelect
                        categories={categories}
                        value={currentVal}
                        onChange={(v) => setRoleValue(role.envVar, v)}
                        disabled={settingsDisabled}
                        roleEnvVar={role.envVar}
                      />

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

      {/* ═══ Section C: Swarm ═══ */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2" style={FONT}>🐝 Helper Types</CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Pick different models for simple vs. complex helper agents.
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
                    <FlatModelSelect
                      categories={categories}
                      value={currentVal}
                      onChange={(v) => setSwarmValue(agent.envVar, v)}
                      disabled={settingsDisabled}
                      placeholder="Inherit from Swarm role"
                    />
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
              ref={useCaseRef}
              type="text"
              defaultValue={useCase}
              onBlur={(e) => setUseCase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !settingsDisabled) {
                  setUseCase((e.target as HTMLInputElement).value);
                  handleGetRecommendations();
                }
              }}
              placeholder="e.g. Voice assistant with coding help..."
              disabled={settingsDisabled}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
              style={FONT}
            />
            <button
              onClick={handleGetRecommendations}
              disabled={settingsDisabled || advisorLoading}
              className="rounded-lg border border-purple-500 bg-purple-500/15 px-4 py-2.5 text-sm text-purple-300 hover:bg-purple-500/25 disabled:opacity-50 whitespace-nowrap transition-all"
            >
              {advisorLoading ? 'Thinking...' : 'Get Recommendations'}
            </button>
          </div>

          {advisorError && <p className="text-xs text-red-400">{advisorError}</p>}

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
                    className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:border-purple-500 hover:text-purple-300 transition-all disabled:opacity-50"
                  >
                    Apply This Config
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Section E: Deploy ═══ */}
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardContent className="py-4 space-y-3" style={FONT}>
          {hasChanges && !settingsDisabled && (
            <div className="rounded-lg border border-yellow-600/50 bg-yellow-900/10 p-3 text-sm text-yellow-300">
              ⚠️ You have unsaved changes. Click below to apply.
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
            {settingsDisabled ? '🚫 Settings Disabled'
              : deploying ? '⏳ Applying...'
              : hasChanges ? '🔄 Apply Changes & Restart Gateway'
              : '✓ All Changes Applied'}
          </button>

          {deployStatus && (
            <div className={`rounded-lg p-3 text-sm text-center ${
              deployStatus.includes('❌') ? 'bg-red-900/20 border border-red-600/30 text-red-300'
                : deployStatus.includes('⚠️') ? 'bg-yellow-900/20 border border-yellow-600/30 text-yellow-300'
                : 'bg-green-900/20 border border-green-600/30 text-green-300'
            }`}>{deployStatus}</div>
          )}

          <div className="border-t border-gray-700 pt-3 mt-2">
            <button
              onClick={async () => {
                setDeployStatus('🔄 Restarting bot gateway...');
                try {
                  const res = await fetch('/api/bot/restart', { method: 'POST' });
                  const data = await res.json();
                  setDeployStatus(data.success ? '✅ Bot gateway restarted.' : `❌ ${data.error}`);
                } catch (err) {
                  setDeployStatus(`❌ ${err instanceof Error ? err.message : 'Unknown'}`);
                }
                setTimeout(() => setDeployStatus(null), 8000);
              }}
              disabled={settingsDisabled || deploying}
              className="w-full rounded-lg px-4 py-2.5 text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white active:bg-gray-800 disabled:opacity-50 transition-all"
              style={FONT}
            >
              🔄 Restart Bot Gateway
            </button>
            <p className="text-[10px] text-gray-600 text-center mt-1">
              Apply .env changes without full redeploy
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ModelSettingsPanel;
