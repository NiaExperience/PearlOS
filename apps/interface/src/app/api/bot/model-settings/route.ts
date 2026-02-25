import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

const log = getLogger('[api_model_settings]');

// Available models for each task type - matches ModelSettingsPanel MODEL_OPTIONS
export const AVAILABLE_MODELS = {
  // Anthropic
  'opus-4.6': {
    id: 'opus-4.6',
    name: 'Opus 4.6',
    modelId: 'anthropic/claude-opus-4-6',
    description: 'Most capable Anthropic model',
    provider: 'Anthropic',
  },
  'opus-4.5': {
    id: 'opus-4.5',
    name: 'Opus 4.5',
    modelId: 'anthropic/claude-opus-4-5',
    description: 'Previous-gen Opus, very capable',
    provider: 'Anthropic',
  },
  'sonnet-4.5': {
    id: 'sonnet-4.5',
    name: 'Sonnet 4.5',
    modelId: 'anthropic/claude-sonnet-4-5',
    description: 'Fast, capable, balanced',
    provider: 'Anthropic',
  },
  'sonnet-4': {
    id: 'sonnet-4',
    name: 'Sonnet 4',
    modelId: 'anthropic/claude-sonnet-4-0',
    description: 'Previous-gen Sonnet',
    provider: 'Anthropic',
  },
  'haiku-4.5': {
    id: 'haiku-4.5',
    name: 'Haiku 4.5',
    modelId: 'anthropic/claude-haiku-4-5',
    description: 'Fast and affordable Anthropic model',
    provider: 'Anthropic',
  },
  'haiku-3.5': {
    id: 'haiku-3.5',
    name: 'Haiku 3.5',
    modelId: 'anthropic/claude-3-5-haiku-latest',
    description: 'Previous-gen Haiku',
    provider: 'Anthropic',
  },
  // OpenAI
  'gpt-4.5-turbo': {
    id: 'gpt-4.5-turbo',
    name: 'GPT-4.5 Turbo',
    modelId: 'openai/gpt-4.5-turbo',
    description: 'Latest GPT model',
    provider: 'OpenAI',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    modelId: 'openai/gpt-4o',
    description: 'Versatile GPT-4',
    provider: 'OpenAI',
  },
  'o3-mini': {
    id: 'o3-mini',
    name: 'O3 Mini',
    modelId: 'openai/o3-mini',
    description: 'Fast reasoning model',
    provider: 'OpenAI',
  },
  'codex-mini': {
    id: 'codex-mini',
    name: 'Codex Mini',
    modelId: 'openai/codex-mini',
    description: 'Code-optimized model',
    provider: 'OpenAI',
  },
  // xAI
  'grok-4.1-fast': {
    id: 'grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    modelId: 'x-ai/grok-4.1-fast',
    description: 'Fast Grok model',
    provider: 'xAI',
  },
  'grok-3-mini': {
    id: 'grok-3-mini',
    name: 'Grok 3 Mini',
    modelId: 'x-ai/grok-3-mini',
    description: 'Lightweight Grok model',
    provider: 'xAI',
  },
  // Google
  'gemini-3.1-pro': {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    modelId: 'google/gemini-3.1-pro-preview',
    description: 'Google flagship model',
    provider: 'Google',
  },
  'gemini-3-flash': {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    modelId: 'google/gemini-3-flash-preview',
    description: 'Fast Gemini model',
    provider: 'Google',
  },
  // DeepSeek
  'deepseek': {
    id: 'deepseek',
    name: 'DeepSeek V3',
    modelId: 'deepseek/deepseek-chat',
    description: 'Great value, strong reasoning',
    provider: 'DeepSeek',
  },
  'deepseek-r1': {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    modelId: 'deepseek/deepseek-r1',
    description: 'DeepSeek reasoning model',
    provider: 'DeepSeek',
  },
  // Qwen
  'qwen-3.5-plus': {
    id: 'qwen-3.5-plus',
    name: 'Qwen 3.5+',
    modelId: 'qwen/qwen3.5-plus',
    description: 'Alibaba Qwen model',
    provider: 'Qwen',
  },
  'qwen-3-235b': {
    id: 'qwen-3-235b',
    name: 'Qwen 3 235B',
    modelId: 'qwen/qwen3-235b-a22b',
    description: 'Large Qwen model',
    provider: 'Qwen',
  },
  // Minimax
  'minimax': {
    id: 'minimax',
    name: 'MiniMax 01',
    modelId: 'openrouter/minimax/minimax-01',
    description: 'MiniMax via OpenRouter',
    provider: 'Minimax',
  },
  // Kimi (Moonshot)
  'kimi-k2': {
    id: 'kimi-k2',
    name: 'Kimi K2',
    modelId: 'moonshotai/kimi-k2-0712-preview',
    description: 'Moonshot AI model',
    provider: 'Moonshot',
  },
  // Trinity
  'trinity-1': {
    id: 'trinity-1',
    name: 'Trinity 1',
    modelId: 'trinity/trinity-1',
    description: 'Trinity model',
    provider: 'Trinity',
  },
  // GLM
  'glm-5': {
    id: 'glm-5',
    name: 'GLM-5',
    modelId: 'openrouter/z-ai/glm-5',
    description: 'Budget-friendly, good tools',
    provider: 'Z-AI',
  },
  // Groq-hosted models
  'groq-llama-3.1-8b': {
    id: 'groq-llama-3.1-8b',
    name: 'Llama 3.1 8B (Groq)',
    modelId: 'groq/llama-3.1-8b-instant',
    description: 'Ultra-fast Llama via Groq',
    provider: 'Groq',
  },
  'groq-llama-3.3-70b': {
    id: 'groq-llama-3.3-70b',
    name: 'Llama 3.3 70B (Groq)',
    modelId: 'groq/llama-3.3-70b-versatile',
    description: 'Large Llama via Groq',
    provider: 'Groq',
  },
  // Liquid
  'lfm2-8b': {
    id: 'lfm2-8b',
    name: 'LFM2 8B',
    modelId: 'liquid/lfm2-8b-a1b',
    description: 'Ultra-cheap Liquid model',
    provider: 'Liquid',
  },
  'lfm-2.2-6b': {
    id: 'lfm-2.2-6b',
    name: 'LFM 2.2 6B',
    modelId: 'liquid/lfm-2.2-6b',
    description: 'Small Liquid model',
    provider: 'Liquid',
  },
  // Meta Llama
  'llama-3.1-8b': {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    modelId: 'meta-llama/llama-3.1-8b-instruct',
    description: 'Small Llama model',
    provider: 'Meta',
  },
  'llama-3.3-70b': {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    modelId: 'meta-llama/llama-3.3-70b-instruct',
    description: 'Large Llama model',
    provider: 'Meta',
  },
  // Mistral
  'mistral-large': {
    id: 'mistral-large',
    name: 'Mistral Large',
    modelId: 'mistralai/mistral-large',
    description: 'Mistral flagship',
    provider: 'Mistral',
  },
  'mistral-nemo': {
    id: 'mistral-nemo',
    name: 'Mistral Nemo',
    modelId: 'mistralai/mistral-nemo',
    description: 'Small Mistral model',
    provider: 'Mistral',
  },
  // Auto
  'auto': {
    id: 'auto',
    name: 'Auto (Smart)',
    modelId: 'openrouter/auto',
    description: 'Let OpenRouter pick',
    provider: 'OpenRouter',
  },
  
  // ═══ ADDITIONAL GROQ MODELS ═══
  'groq-llama-3.1-70b': {
    id: 'groq-llama-3.1-70b',
    name: 'Llama 3.1 70B (Groq)',
    modelId: 'groq/llama-3.1-70b-versatile',
    description: 'Large Llama model via Groq',
    provider: 'Groq',
  },
  'groq-deepseek-r1': {
    id: 'groq-deepseek-r1',
    name: 'DeepSeek R1 Distill (Groq)',
    modelId: 'groq/deepseek-r1-distill-llama-70b',
    description: 'DeepSeek reasoning via Groq',
    provider: 'Groq',
  },
  'groq-mixtral-8x7b': {
    id: 'groq-mixtral-8x7b',
    name: 'Mixtral 8x7B (Groq)',
    modelId: 'groq/mixtral-8x7b-32768',
    description: 'Mixtral model via Groq',
    provider: 'Groq',
  },
  'groq-gemma2-9b': {
    id: 'groq-gemma2-9b',
    name: 'Gemma2 9B (Groq)',
    modelId: 'groq/gemma2-9b-it',
    description: 'Google Gemma2 via Groq',
    provider: 'Groq',
  },
  'groq-gemma-7b': {
    id: 'groq-gemma-7b',
    name: 'Gemma 7B (Groq)',
    modelId: 'groq/gemma-7b-it',
    description: 'Google Gemma via Groq',
    provider: 'Groq',
  },
  
  // ═══ ANTHROPIC VIA OPENROUTER ═══
  'or-claude-opus-4.6': {
    id: 'or-claude-opus-4.6',
    name: 'Claude Opus 4.6 (OpenRouter)',
    modelId: 'openrouter/anthropic/claude-opus-4.6',
    description: 'Anthropic Opus 4.6 via OpenRouter',
    provider: 'Anthropic via OpenRouter',
  },
  'or-claude-opus-4.5': {
    id: 'or-claude-opus-4.5',
    name: 'Claude Opus 4.5 (OpenRouter)',
    modelId: 'openrouter/anthropic/claude-opus-4.5',
    description: 'Anthropic Opus 4.5 via OpenRouter',
    provider: 'Anthropic via OpenRouter',
  },
  'or-claude-opus-4.1': {
    id: 'or-claude-opus-4.1',
    name: 'Claude Opus 4.1 (OpenRouter)',
    modelId: 'openrouter/anthropic/claude-opus-4-1',
    description: 'Anthropic Opus 4.1 via OpenRouter',
    provider: 'Anthropic via OpenRouter',
  },
  'or-claude-sonnet-4.5': {
    id: 'or-claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5 (OpenRouter)',
    modelId: 'openrouter/anthropic/claude-sonnet-4.5',
    description: 'Anthropic Sonnet 4.5 via OpenRouter',
    provider: 'Anthropic via OpenRouter',
  },
  'or-claude-haiku-4.5': {
    id: 'or-claude-haiku-4.5',
    name: 'Claude Haiku 4.5 (OpenRouter)',
    modelId: 'openrouter/anthropic/claude-haiku-4.5',
    description: 'Anthropic Haiku 4.5 via OpenRouter',
    provider: 'Anthropic via OpenRouter',
  },
  'or-claude-3.7-sonnet': {
    id: 'or-claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet (OpenRouter)',
    modelId: 'openrouter/anthropic/claude-3.7-sonnet',
    description: 'Anthropic 3.7 Sonnet via OpenRouter',
    provider: 'Anthropic via OpenRouter',
  },
  
  // ═══ OPENAI VIA OPENROUTER ═══
  'or-gpt-5': {
    id: 'or-gpt-5',
    name: 'GPT-5 (OpenRouter)',
    modelId: 'openrouter/openai/gpt-5',
    description: 'OpenAI GPT-5 via OpenRouter',
    provider: 'OpenAI via OpenRouter',
  },
  'or-gpt-4o': {
    id: 'or-gpt-4o',
    name: 'GPT-4o (OpenRouter)',
    modelId: 'openrouter/openai/gpt-4o',
    description: 'OpenAI GPT-4o via OpenRouter',
    provider: 'OpenAI via OpenRouter',
  },
  'or-o3': {
    id: 'or-o3',
    name: 'O3 (OpenRouter)',
    modelId: 'openrouter/openai/o3',
    description: 'OpenAI O3 via OpenRouter',
    provider: 'OpenAI via OpenRouter',
  },
  'or-o4-mini': {
    id: 'or-o4-mini',
    name: 'O4 Mini (OpenRouter)',
    modelId: 'openrouter/openai/o4-mini',
    description: 'OpenAI O4 Mini via OpenRouter',
    provider: 'OpenAI via OpenRouter',
  },
  
  // ═══ XAI VIA OPENROUTER ═══
  'or-grok-4': {
    id: 'or-grok-4',
    name: 'Grok 4 (OpenRouter)',
    modelId: 'openrouter/x-ai/grok-4',
    description: 'xAI Grok 4 via OpenRouter',
    provider: 'xAI via OpenRouter',
  },
  'or-grok-4-fast': {
    id: 'or-grok-4-fast',
    name: 'Grok 4 Fast (OpenRouter)',
    modelId: 'openrouter/x-ai/grok-4-fast',
    description: 'xAI Grok 4 Fast via OpenRouter',
    provider: 'xAI via OpenRouter',
  },
  'or-grok-3': {
    id: 'or-grok-3',
    name: 'Grok 3 (OpenRouter)',
    modelId: 'openrouter/x-ai/grok-3',
    description: 'xAI Grok 3 via OpenRouter',
    provider: 'xAI via OpenRouter',
  },
  'or-grok-3-mini': {
    id: 'or-grok-3-mini',
    name: 'Grok 3 Mini (OpenRouter)',
    modelId: 'openrouter/x-ai/grok-3-mini',
    description: 'xAI Grok 3 Mini via OpenRouter',
    provider: 'xAI via OpenRouter',
  },
  
  // ═══ GOOGLE VIA OPENROUTER ═══
  'or-gemini-3-pro': {
    id: 'or-gemini-3-pro',
    name: 'Gemini 3 Pro (OpenRouter)',
    modelId: 'openrouter/google/gemini-3-pro-preview',
    description: 'Google Gemini 3 Pro via OpenRouter',
    provider: 'Google via OpenRouter',
  },
  'or-gemini-3-flash': {
    id: 'or-gemini-3-flash',
    name: 'Gemini 3 Flash (OpenRouter)',
    modelId: 'openrouter/google/gemini-3-flash-preview',
    description: 'Google Gemini 3 Flash via OpenRouter',
    provider: 'Google via OpenRouter',
  },
  'or-gemini-2.5-pro': {
    id: 'or-gemini-2.5-pro',
    name: 'Gemini 2.5 Pro (OpenRouter)',
    modelId: 'openrouter/google/gemini-2.5-pro',
    description: 'Google Gemini 2.5 Pro via OpenRouter',
    provider: 'Google via OpenRouter',
  },
  'or-gemini-2.5-flash': {
    id: 'or-gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (OpenRouter)',
    modelId: 'openrouter/google/gemini-2.5-flash',
    description: 'Google Gemini 2.5 Flash via OpenRouter',
    provider: 'Google via OpenRouter',
  },
  
  // ═══ DEEPSEEK VIA OPENROUTER ═══
  'or-deepseek-r1': {
    id: 'or-deepseek-r1',
    name: 'DeepSeek R1 (OpenRouter)',
    modelId: 'openrouter/deepseek/deepseek-r1',
    description: 'DeepSeek R1 via OpenRouter',
    provider: 'DeepSeek via OpenRouter',
  },
  'or-deepseek-chat': {
    id: 'or-deepseek-chat',
    name: 'DeepSeek V3 (OpenRouter)',
    modelId: 'openrouter/deepseek/deepseek-chat',
    description: 'DeepSeek V3 via OpenRouter',
    provider: 'DeepSeek via OpenRouter',
  },
  'or-deepseek-v3.2': {
    id: 'or-deepseek-v3.2',
    name: 'DeepSeek V3.2 (OpenRouter)',
    modelId: 'openrouter/deepseek/deepseek-v3.2',
    description: 'DeepSeek V3.2 via OpenRouter',
    provider: 'DeepSeek via OpenRouter',
  },
  
  // ═══ QWEN VIA OPENROUTER ═══
  'or-qwen3-coder': {
    id: 'or-qwen3-coder',
    name: 'Qwen 3 Coder (OpenRouter)',
    modelId: 'openrouter/qwen/qwen3-coder',
    description: 'Qwen 3 Coder via OpenRouter',
    provider: 'Qwen via OpenRouter',
  },
  'or-qwen3-235b': {
    id: 'or-qwen3-235b',
    name: 'Qwen 3 235B (OpenRouter)',
    modelId: 'openrouter/qwen/qwen3-235b-a22b',
    description: 'Qwen 3 235B via OpenRouter',
    provider: 'Qwen via OpenRouter',
  },
  'or-qwen-2.5-72b': {
    id: 'or-qwen-2.5-72b',
    name: 'Qwen 2.5 72B (OpenRouter)',
    modelId: 'openrouter/qwen/qwen-2.5-72b-instruct',
    description: 'Qwen 2.5 72B via OpenRouter',
    provider: 'Qwen via OpenRouter',
  },
  
  // ═══ OTHER PROVIDERS VIA OPENROUTER ═══
  'or-minimax-m2.1': {
    id: 'or-minimax-m2.1',
    name: 'MiniMax M2.1 (OpenRouter)',
    modelId: 'openrouter/minimax/minimax-m2.1',
    description: 'MiniMax M2.1 via OpenRouter',
    provider: 'MiniMax via OpenRouter',
  },
  'or-kimi-k2': {
    id: 'or-kimi-k2',
    name: 'Kimi K2 (OpenRouter)',
    modelId: 'openrouter/moonshotai/kimi-k2',
    description: 'Kimi K2 via OpenRouter',
    provider: 'Moonshot via OpenRouter',
  },
  'or-kimi-k2.5': {
    id: 'or-kimi-k2.5',
    name: 'Kimi K2.5 (OpenRouter)',
    modelId: 'openrouter/moonshotai/kimi-k2.5',
    description: 'Kimi K2.5 via OpenRouter',
    provider: 'Moonshot via OpenRouter',
  },
  'or-glm-5': {
    id: 'or-glm-5',
    name: 'GLM-5 (OpenRouter)',
    modelId: 'openrouter/z-ai/glm-5',
    description: 'GLM-5 via OpenRouter',
    provider: 'Z-AI via OpenRouter',
  },
  'or-glm-4.7': {
    id: 'or-glm-4.7',
    name: 'GLM-4.7 (OpenRouter)',
    modelId: 'openrouter/z-ai/glm-4.7',
    description: 'GLM-4.7 via OpenRouter',
    provider: 'Z-AI via OpenRouter',
  },
  'or-llama-3.3-70b': {
    id: 'or-llama-3.3-70b',
    name: 'Llama 3.3 70B (OpenRouter)',
    modelId: 'openrouter/meta-llama/llama-3.3-70b-instruct',
    description: 'Llama 3.3 70B via OpenRouter',
    provider: 'Meta via OpenRouter',
  },
  'or-llama-4-maverick': {
    id: 'or-llama-4-maverick',
    name: 'Llama 4 Maverick (OpenRouter)',
    modelId: 'openrouter/meta-llama/llama-4-maverick',
    description: 'Llama 4 Maverick via OpenRouter',
    provider: 'Meta via OpenRouter',
  },
  'or-mistral-large': {
    id: 'or-mistral-large',
    name: 'Mistral Large (OpenRouter)',
    modelId: 'openrouter/mistralai/mistral-large',
    description: 'Mistral Large via OpenRouter',
    provider: 'Mistral via OpenRouter',
  },
  'or-mistral-nemo': {
    id: 'or-mistral-nemo',
    name: 'Mistral Nemo (OpenRouter)',
    modelId: 'openrouter/mistralai/mistral-nemo',
    description: 'Mistral Nemo via OpenRouter',
    provider: 'Mistral via OpenRouter',
  },
} as const;

type ModelKey = keyof typeof AVAILABLE_MODELS;

// Task type configuration
export const TASK_TYPES = {
  voice: {
    key: 'voice',
    label: 'Voice Conversations',
    description: 'Primary LLM for voice interactions',
    envVar: 'BOT_VOICE_MODEL',
    defaultModel: 'sonnet',
  },
  tools: {
    key: 'tools',
    label: 'Tool Calls',
    description: 'Function calling and tools',
    envVar: 'BOT_TOOLS_MODEL',
    defaultModel: 'glm-5',
  },
  swarm: {
    key: 'swarm',
    label: 'Swarm Orchestration',
    description: 'Sub-agent spawning',
    envVar: 'BOT_SWARM_MODEL',
    defaultModel: 'opus',
  },
  thinking: {
    key: 'thinking',
    label: 'Thinking/Reasoning',
    description: 'Complex reasoning tasks',
    envVar: 'BOT_THINKING_MODEL',
    defaultModel: 'sonnet',
  },
  vision: {
    key: 'vision',
    label: 'Vision / Image Understanding',
    description: 'Image analysis, screenshots, visual input for Pearl Vision',
    envVar: 'BOT_VISION_MODEL',
    defaultModel: 'gpt-4o',
  },
} as const;

type TaskKey = keyof typeof TASK_TYPES;

// Path to the pipecat-daily-bot .env file
const BOT_ENV_PATH = process.env.PIPECAT_BOT_ENV_PATH || 
  path.join(process.cwd(), '..', 'pipecat-daily-bot', '.env');

interface ModelConfig {
  voice: ModelKey;
  tools: ModelKey;
  swarm: ModelKey;
  thinking: ModelKey;
  vision: ModelKey;
}

/**
 * Read current model configuration from .env file
 */
function readCurrentConfig(): ModelConfig {
  const defaults: ModelConfig = {
    voice: 'sonnet',
    tools: 'glm-5',
    swarm: 'opus',
    thinking: 'sonnet',
    vision: 'gpt-4o',
  };

  try {
    if (!fs.existsSync(BOT_ENV_PATH)) {
      log.warn('Bot .env.local file not found', { path: BOT_ENV_PATH });
      return defaults;
    }

    const content = fs.readFileSync(BOT_ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    const envVars: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          let value = trimmed.substring(eqIdx + 1).trim();
          // Remove quotes if present
          if ((value.startsWith("'") && value.endsWith("'")) || 
              (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
          }
          envVars[key] = value;
        }
      }
    }

    // Map env values to model keys
    const config = { ...defaults };
    
    for (const [taskKey, taskConfig] of Object.entries(TASK_TYPES)) {
      const envValue = envVars[taskConfig.envVar];
      if (envValue) {
        // Check if it matches any known model ID (normalize openrouter/ prefix)
        const normalizedEnv = envValue.replace(/^openrouter\//, '');
        for (const [modelKey, modelInfo] of Object.entries(AVAILABLE_MODELS)) {
          const normalizedModelId = modelInfo.modelId.replace(/^openrouter\//, '');
          if (envValue === modelInfo.modelId || envValue === modelKey
              || normalizedEnv === normalizedModelId || normalizedEnv === modelKey) {
            config[taskKey as TaskKey] = modelKey as ModelKey;
            break;
          }
        }
      }
    }

    return config;
  } catch (error) {
    log.error('Failed to read bot .env.local file', { error });
    return defaults;
  }
}

/**
 * Update .env file with new model configuration
 */
function updateEnvFile(config: ModelConfig): { success: boolean; error?: string } {
  try {
    if (!fs.existsSync(BOT_ENV_PATH)) {
      return { success: false, error: 'Bot .env.local file not found' };
    }

    const content = fs.readFileSync(BOT_ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    const updatedLines: string[] = [];
    const updated = new Set<string>();

    // Map config to env values (only update tasks that were provided)
    const envUpdates: Record<string, string> = {};
    for (const [taskKey, taskConfig] of Object.entries(TASK_TYPES)) {
      const modelKey = config[taskKey as TaskKey];
      if (!modelKey) continue; // Skip tasks not included in partial config
      const modelInfo = AVAILABLE_MODELS[modelKey];
      if (!modelInfo) {
        log.warn('Model key not found in AVAILABLE_MODELS', { taskKey, modelKey });
        continue;
      }
      envUpdates[taskConfig.envVar] = modelInfo.modelId;
    }

    // Update existing lines
    for (const line of lines) {
      let newLine = line;
      const trimmed = line.trim();
      
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          if (envUpdates[key]) {
            newLine = `${key}=${envUpdates[key]}`;
            updated.add(key);
          }
        }
      }
      
      updatedLines.push(newLine);
    }

    // Add any missing keys at the end
    for (const [key, value] of Object.entries(envUpdates)) {
      if (!updated.has(key)) {
        updatedLines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(BOT_ENV_PATH, updatedLines.join('\n'), 'utf-8');
    log.info('Updated bot .env.local with model settings', { path: BOT_ENV_PATH });
    
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Failed to update bot .env.local file', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * GET /api/bot/model-settings
 * Returns current model configuration
 */
export async function GET() {
  const config = readCurrentConfig();
  const envExists = fs.existsSync(BOT_ENV_PATH);
  
  return NextResponse.json({
    config,
    availableModels: AVAILABLE_MODELS,
    taskTypes: TASK_TYPES,
    envPath: BOT_ENV_PATH,
    envExists,
  });
}

/**
 * Write arbitrary env vars directly to the .env file (for BOT_FAST_MODEL etc.)
 */
function writeDirectEnvVars(envVars: Record<string, string>): { success: boolean; error?: string } {
  try {
    if (!fs.existsSync(BOT_ENV_PATH)) {
      return { success: false, error: 'Bot .env file not found' };
    }
    // Only allow BOT_* env vars for safety
    const ALLOWED_PREFIX = 'BOT_';
    for (const key of Object.keys(envVars)) {
      if (!key.startsWith(ALLOWED_PREFIX)) {
        return { success: false, error: `Only BOT_* env vars allowed, got: ${key}` };
      }
    }

    const content = fs.readFileSync(BOT_ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    const updatedLines: string[] = [];
    const updated = new Set<string>();

    for (const line of lines) {
      let newLine = line;
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          if (envVars[key] !== undefined) {
            newLine = `${key}=${envVars[key]}`;
            updated.add(key);
          }
        }
      }
      updatedLines.push(newLine);
    }

    for (const [key, value] of Object.entries(envVars)) {
      if (!updated.has(key)) {
        updatedLines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(BOT_ENV_PATH, updatedLines.join('\n'), 'utf-8');
    log.info('Updated bot .env with direct env vars', { keys: Object.keys(envVars) });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

/**
 * POST /api/bot/model-settings
 * Updates model configuration. Accepts either:
 * - { config: { voice: 'sonnet', tools: 'glm-5', ... } } — task-type model keys
 * - { directEnv: { BOT_FAST_MODEL: 'groq/llama-3.3-70b', ... } } — direct env var writes
 * - Both can be provided simultaneously
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication (bypass in test mode)
    const testMode = process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true';
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!testMode && !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { config, directEnv } = body as { config?: ModelConfig; directEnv?: Record<string, string> };

    if (!config && !directEnv) {
      return NextResponse.json({ 
        error: 'Missing config or directEnv object' 
      }, { status: 400 });
    }

    // Handle task-type config
    if (config) {
      const validKeys = Object.keys(AVAILABLE_MODELS);
      for (const [taskKey, modelKey] of Object.entries(config)) {
        if (!validKeys.includes(modelKey)) {
          return NextResponse.json({ 
            error: `Invalid model key '${modelKey}' for task '${taskKey}'` 
          }, { status: 400 });
        }
      }
      const result = updateEnvFile(config);
      if (!result.success) {
        return NextResponse.json({ error: result.error || 'Failed to update model settings' }, { status: 500 });
      }
    }

    // Handle direct env var writes
    if (directEnv) {
      const result = writeDirectEnvVars(directEnv);
      if (!result.success) {
        return NextResponse.json({ error: result.error || 'Failed to write env vars' }, { status: 500 });
      }
    }

    const userModel = (session?.user as any)?.email || session?.user?.id || 'test-mode';
    log.info('Model settings updated', { config, directEnv, user: userModel });

    return NextResponse.json({
      success: true,
      config,
      directEnv,
      message: 'Model settings updated. Changes will apply to new bot sessions.',
      restartRequired: false,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Failed to update model settings', { error: errorMsg });
    return NextResponse.json({ 
      error: `Failed to update model settings: ${errorMsg}` 
    }, { status: 500 });
  }
}
