/**
 * Model Preference API
 * 
 * Returns the user's preferred model for a given channel (e.g., "voice").
 * Reads from the bot model-settings config (same source as /api/bot/model-settings)
 * so the voice bot can query what model the UI has selected.
 * 
 * GET /api/model-preference?channel=voice
 * Response: { model: string | null, provider: string | null, modelId: string | null }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

const log = getLogger('[api_model_preference]');

// Map of channel → env var that holds the model ID
const CHANNEL_MODEL_ENV: Record<string, string> = {
  voice: 'BOT_VOICE_MODEL',
  tools: 'BOT_TOOLS_MODEL',
  swarm: 'BOT_SWARM_MODEL',
  thinking: 'BOT_THINKING_MODEL',
  vision: 'BOT_VISION_MODEL',
};

const BOT_ENV_PATH = process.env.PIPECAT_BOT_ENV_PATH ||
  path.join(process.cwd(), '..', 'pipecat-daily-bot', '.env');

/**
 * Parse the bot .env file and return a key-value map.
 */
function readBotEnv(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    if (!fs.existsSync(BOT_ENV_PATH)) return vars;
    const content = fs.readFileSync(BOT_ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      let value = trimmed.substring(eqIdx + 1).trim();
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  } catch (err) {
    log.error('Failed to read bot env', { error: err });
  }
  return vars;
}

/**
 * Parse a model ID like "anthropic/claude-sonnet-4-5" into provider + model.
 */
function parseModelId(modelId: string): { provider: string | null; model: string | null } {
  if (!modelId) return { provider: null, model: null };
  
  // Handle openrouter/ prefix: openrouter/anthropic/claude-xxx → provider=anthropic, model=claude-xxx
  if (modelId.startsWith('openrouter/')) {
    const rest = modelId.slice('openrouter/'.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx > 0) {
      return {
        provider: rest.substring(0, slashIdx),
        model: rest.substring(slashIdx + 1),
      };
    }
    return { provider: 'openrouter', model: rest };
  }
  
  // Standard: provider/model
  const slashIdx = modelId.indexOf('/');
  if (slashIdx > 0) {
    return {
      provider: modelId.substring(0, slashIdx),
      model: modelId.substring(slashIdx + 1),
    };
  }
  
  return { provider: null, model: modelId };
}

export async function GET(req: NextRequest) {
  // Allow internal bot calls without auth (they use a shared secret)
  const internalSecret = req.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_API_SECRET || 'pearl-internal';
  
  if (internalSecret !== expectedSecret) {
    // Fall back to session auth
    const testMode = process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true';
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!testMode && !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const channel = req.nextUrl.searchParams.get('channel') || 'voice';
  const envVar = CHANNEL_MODEL_ENV[channel];
  
  if (!envVar) {
    return NextResponse.json({
      model: null,
      provider: null,
      modelId: null,
      channel,
      error: `Unknown channel: ${channel}`,
    }, { status: 400 });
  }

  const botEnv = readBotEnv();
  const modelId = botEnv[envVar] || null;
  
  if (!modelId) {
    return NextResponse.json({
      model: null,
      provider: null,
      modelId: null,
      channel,
    });
  }

  const { provider, model } = parseModelId(modelId);
  
  log.info('Model preference queried', { channel, modelId, provider, model });
  
  return NextResponse.json({
    model,
    provider,
    modelId,
    channel,
  });
}
