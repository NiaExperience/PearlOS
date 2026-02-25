/**
 * Bot LLM Mode API
 * GET — Returns the current BOT_LLM_MODE from the bot .env file.
 * Used by the Settings UI to determine which model config sections are active.
 */
import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const BOT_ENV_PATH = process.env.PIPECAT_BOT_ENV_PATH ||
  path.join(process.cwd(), '..', 'pipecat-daily-bot', '.env');

// All model role env var names
const ALL_MODEL_ROLES = [
  'BOT_VOICE_MODEL',
  'BOT_TOOLS_MODEL',
  'BOT_SWARM_MODEL',
  'BOT_THINKING_MODEL',
  'BOT_VISION_MODEL',
  'BOT_FAST_MODEL',
] as const;

export async function GET() {
  try {
    if (!fs.existsSync(BOT_ENV_PATH)) {
      return NextResponse.json({ mode: 'unknown', error: 'Bot .env not found' });
    }

    const content = fs.readFileSync(BOT_ENV_PATH, 'utf-8');
    const lines = content.split('\n');

    let mode = 'unknown';
    let nonBlockingTools = false;
    let visionEnabled = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('BOT_LLM_MODE=')) {
        mode = trimmed.split('=')[1]?.trim().replace(/['"]/g, '') || 'unknown';
      }
      if (trimmed.startsWith('BOT_NON_BLOCKING_TOOLS=')) {
        nonBlockingTools = trimmed.split('=')[1]?.trim().replace(/['"]/g, '').toLowerCase() === 'true';
      }
      if (trimmed.startsWith('BOT_VISION_ENABLED=')) {
        visionEnabled = trimmed.split('=')[1]?.trim().replace(/['"]/g, '').toLowerCase() === 'true';
      }
    }

    const isOpenclawSession = mode === 'openclaw_session';

    // Determine which model roles are actively used
    let activeRoles: string[];
    if (!isOpenclawSession) {
      // All roles are active in non-openclaw modes
      activeRoles = [...ALL_MODEL_ROLES];
    } else if (nonBlockingTools) {
      // openclaw_session + non-blocking tools: fast model, vision, and thinking are used
      activeRoles = ['BOT_FAST_MODEL', 'BOT_VISION_MODEL', 'BOT_THINKING_MODEL'];
    } else {
      // openclaw_session without non-blocking tools: only vision and thinking
      activeRoles = ['BOT_VISION_MODEL', 'BOT_THINKING_MODEL'];
    }

    // Remove vision role if vision is not enabled
    if (!visionEnabled) {
      activeRoles = activeRoles.filter(r => r !== 'BOT_VISION_MODEL');
    }

    return NextResponse.json({
      mode,
      nonBlockingTools,
      isOpenclawSession,
      // In openclaw_session mode, the Gateway's openclaw.json primary model
      // is the ONLY model that matters. Bot .env model roles are ignored
      // (except for roles listed in activeRoles).
      activeConfigSource: isOpenclawSession ? 'openclaw.json' : 'bot .env',
      visionEnabled,
      activeRoles,
    });
  } catch (error) {
    return NextResponse.json(
      { mode: 'unknown', error: String(error) },
      { status: 500 }
    );
  }
}
