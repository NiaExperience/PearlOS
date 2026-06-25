import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { isTestModeBypassAllowed } from '@interface/lib/api-auth';
import { getLogger } from '@interface/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

const log = getLogger('[api_model_preset]');

// Model preset configurations
export const MODEL_PRESETS = {
  'glm-5': {
    name: 'GLM-5',
    description: 'OpenRouter GLM-5 for all routes',
    models: {
      BOT_FAST_MODEL: 'openrouter/z-ai/glm-5',
      BOT_OPENCLAW_MODEL: 'openrouter/z-ai/glm-5',
      BOT_ESCALATION_MODEL: 'openrouter/z-ai/glm-5',
    },
  },
  'deepseek': {
    name: 'DeepSeek',
    description: 'DeepSeek Chat for all routes',
    models: {
      BOT_FAST_MODEL: 'deepseek/deepseek-chat',
      BOT_OPENCLAW_MODEL: 'deepseek/deepseek-chat',
      BOT_ESCALATION_MODEL: 'deepseek/deepseek-chat',
    },
  },
  'hybrid': {
    name: 'Groq Fast + DeepSeek Tools',
    description: 'Groq Llama 3.3 70B for voice, DeepSeek for complex tasks',
    models: {
      BOT_FAST_MODEL: 'groq/llama-3.3-70b',
      BOT_OPENCLAW_MODEL: 'deepseek/deepseek-chat',
      BOT_ESCALATION_MODEL: 'deepseek/deepseek-chat',
    },
  },
} as const;

type PresetKey = keyof typeof MODEL_PRESETS;

// Path to the pipecat-daily-bot .env file
const BOT_ENV_PATH = process.env.PIPECAT_BOT_ENV_PATH || 
  path.join(process.cwd(), '..', 'pipecat-daily-bot', '.env');

interface PresetStatus {
  current: PresetKey | 'custom' | 'unknown';
  models: {
    BOT_FAST_MODEL: string | null;
    BOT_OPENCLAW_MODEL: string | null;
    BOT_ESCALATION_MODEL: string | null;
  };
}

/**
 * Read current model configuration from .env file
 */
function readCurrentModels(): PresetStatus {
  const models = {
    BOT_FAST_MODEL: null as string | null,
    BOT_OPENCLAW_MODEL: null as string | null,
    BOT_ESCALATION_MODEL: null as string | null,
  };

  try {
    if (!fs.existsSync(BOT_ENV_PATH)) {
      log.warn('Bot .env file not found', { path: BOT_ENV_PATH });
      return { current: 'unknown', models };
    }

    const content = fs.readFileSync(BOT_ENV_PATH, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('BOT_FAST_MODEL=')) {
        models.BOT_FAST_MODEL = trimmed.split('=')[1]?.trim() || null;
      } else if (trimmed.startsWith('BOT_OPENCLAW_MODEL=')) {
        models.BOT_OPENCLAW_MODEL = trimmed.split('=')[1]?.trim() || null;
      } else if (trimmed.startsWith('BOT_ESCALATION_MODEL=')) {
        models.BOT_ESCALATION_MODEL = trimmed.split('=')[1]?.trim() || null;
      }
    }

    // Detect which preset matches
    for (const [key, preset] of Object.entries(MODEL_PRESETS)) {
      if (
        models.BOT_FAST_MODEL === preset.models.BOT_FAST_MODEL &&
        models.BOT_OPENCLAW_MODEL === preset.models.BOT_OPENCLAW_MODEL &&
        models.BOT_ESCALATION_MODEL === preset.models.BOT_ESCALATION_MODEL
      ) {
        return { current: key as PresetKey, models };
      }
    }

    return { current: 'custom', models };
  } catch (error) {
    log.error('Failed to read bot .env file', { error });
    return { current: 'unknown', models };
  }
}

/**
 * Update .env file with new model preset
 */
function updateEnvFile(preset: PresetKey): { success: boolean; error?: string } {
  try {
    const presetConfig = MODEL_PRESETS[preset];
    if (!presetConfig) {
      return { success: false, error: 'Invalid preset' };
    }

    if (!fs.existsSync(BOT_ENV_PATH)) {
      return { success: false, error: 'Bot .env file not found' };
    }

    const content = fs.readFileSync(BOT_ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    const updatedLines: string[] = [];
    const updated = new Set<string>();

    for (const line of lines) {
      let newLine = line;
      
      for (const [key, value] of Object.entries(presetConfig.models)) {
        if (line.trim().startsWith(`${key}=`)) {
          newLine = `${key}=${value}`;
          updated.add(key);
        }
      }
      
      updatedLines.push(newLine);
    }

    // Add any missing keys at the end
    for (const [key, value] of Object.entries(presetConfig.models)) {
      if (!updated.has(key)) {
        updatedLines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(BOT_ENV_PATH, updatedLines.join('\n'), 'utf-8');
    log.info('Updated bot .env with model preset', { preset, path: BOT_ENV_PATH });
    
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Failed to update bot .env file', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * GET /api/bot/model-preset
 * Returns current model preset status
 */
export async function GET() {
  const status = readCurrentModels();
  
  return NextResponse.json({
    current: status.current,
    models: status.models,
    presets: MODEL_PRESETS,
  });
}

/**
 * POST /api/bot/model-preset
 * Updates model preset
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication (bypass in test mode)
    const testMode = isTestModeBypassAllowed();
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!testMode && !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { preset } = body as { preset: PresetKey };

    if (!preset || !MODEL_PRESETS[preset]) {
      return NextResponse.json({ 
        error: 'Invalid preset. Valid options: glm-5, deepseek, hybrid' 
      }, { status: 400 });
    }

    const result = updateEnvFile(preset);
    
    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Failed to update model preset' 
      }, { status: 500 });
    }

    log.info('Model preset updated', { 
      preset, 
      user: (session?.user as any)?.email || session?.user?.id || 'test-mode'
    });

    return NextResponse.json({
      success: true,
      preset,
      presetConfig: MODEL_PRESETS[preset],
      message: `Model preset changed to ${MODEL_PRESETS[preset].name}. Restart the bot gateway to apply changes.`,
      restartRequired: true,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Failed to update model preset', { error: errorMsg });
    return NextResponse.json({ 
      error: `Failed to update model preset: ${errorMsg}` 
    }, { status: 500 });
  }
}
