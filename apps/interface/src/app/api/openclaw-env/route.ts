/**
 * OpenClaw .env API
 * GET  — read provider API keys (masked)
 * POST — update/add/remove provider API keys
 * DELETE — remove specific provider API key
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const ENV_PATH = process.env.OPENCLAW_ENV_PATH ?? join(homedir(), '.openclaw', '.env');
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? join(homedir(), '.openclaw', 'openclaw.json');

// Known provider environment variable keys
const PROVIDER_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

// Enabled flag env vars (absence or any value other than 'false' means enabled)
const PROVIDER_ENABLED_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_ENABLED',
  openai: 'OPENAI_ENABLED',
  openrouter: 'OPENROUTER_ENABLED',
  google: 'GOOGLE_ENABLED',
  groq: 'GROQ_ENABLED',
  xai: 'XAI_ENABLED',
  deepseek: 'DEEPSEEK_ENABLED',
};

function parseEnvFile(content: string): Record<string, string> {
  const lines = content.split('\n');
  const result: Record<string, string> = {};
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      result[key.trim()] = value.trim();
    }
  }
  
  return result;
}

function serializeEnvFile(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
}

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return key ? '••••' : '';
  // Show only last 4 characters with short prefix to prevent layout breaking
  // Format: "sk-...XXXX" or "gsk_...XXXX" depending on key prefix
  const last4 = key.slice(-4);
  const prefix = key.startsWith('sk-') ? 'sk-' : 
                 key.startsWith('gsk_') ? 'gsk_' :
                 key.slice(0, Math.min(4, key.length - 4));
  return `${prefix}...${last4}`;
}

interface AuthProfile {
  provider: string;
  mode: 'api_key' | 'token';
}

interface OpenClawConfig {
  auth?: {
    profiles?: Record<string, AuthProfile>;
  };
}

export async function GET() {
  try {
    const content = await readFile(ENV_PATH, 'utf-8').catch(() => '');
    const vars = parseEnvFile(content);
    
    // Also read openclaw.json for profile-based auth
    let config: OpenClawConfig = {};
    try {
      const configContent = await readFile(CONFIG_PATH, 'utf-8');
      config = JSON.parse(configContent);
    } catch {
      // Config file might not exist or be readable
    }
    
    // Return provider status with masked keys and enabled state
    const providers: Record<string, { 
      connected: boolean; 
      keyMasked?: string; 
      envVar: string; 
      enabled: boolean;
      authMode?: 'api_key' | 'token';
      authProfile?: string;
    }> = {};
    
    for (const [providerId, envVar] of Object.entries(PROVIDER_KEYS)) {
      const value = vars[envVar];
      const enabledKey = PROVIDER_ENABLED_KEYS[providerId];
      const enabled = enabledKey ? vars[enabledKey] !== 'false' : true;
      
      // Check for profile-based auth
      const profiles = config.auth?.profiles || {};
      const providerProfiles = Object.entries(profiles)
        .filter(([_, profile]) => profile.provider === providerId);
      
      const hasEnvKey = !!value;
      const hasProfile = providerProfiles.length > 0;
      const connected = hasEnvKey || hasProfile;
      
      // Determine auth mode and profile name
      let authMode: 'api_key' | 'token' | undefined;
      let authProfile: string | undefined;
      
      if (hasProfile) {
        // Prefer token mode if it exists, otherwise use first profile
        const tokenProfile = providerProfiles.find(([_, p]) => p.mode === 'token');
        const [profileName, profile] = tokenProfile || providerProfiles[0];
        authMode = profile.mode;
        authProfile = profileName;
      } else if (hasEnvKey) {
        authMode = 'api_key';
      }
      
      providers[providerId] = {
        connected,
        keyMasked: value ? maskApiKey(value) : (hasProfile ? '(profile)' : undefined),
        envVar,
        enabled,
        authMode,
        authProfile,
      };
    }
    
    return NextResponse.json({ providers });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read OpenClaw .env', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, apiKey } = body;
    
    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "provider" field' }, { status: 400 });
    }
    
    const envVar = PROVIDER_KEYS[provider];
    if (!envVar) {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}. Valid providers: ${Object.keys(PROVIDER_KEYS).join(', ')}` },
        { status: 400 }
      );
    }
    
    // Read existing .env
    const content = await readFile(ENV_PATH, 'utf-8').catch(() => '');
    const vars = parseEnvFile(content);
    
    // Update or remove the key
    if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
      vars[envVar] = apiKey.trim();
    } else {
      delete vars[envVar];
    }
    
    // Write back
    await writeFile(ENV_PATH, serializeEnvFile(vars), 'utf-8');
    
    // Trigger gateway restart to pick up new env vars
    try {
      await fetch(`http://localhost:18789/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'provider-credentials-updated' }),
      }).catch(() => {
        // Non-fatal if restart fails
      });
    } catch {
      // Silent
    }
    
    return NextResponse.json({
      ok: true,
      provider,
      connected: !!apiKey,
      message: apiKey ? `${provider} credentials saved. Gateway restart triggered.` : `${provider} credentials removed.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update OpenClaw .env', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, enabled } = body;

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "provider" field' }, { status: 400 });
    }

    const enabledKey = PROVIDER_ENABLED_KEYS[provider];
    if (!enabledKey) {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}. Valid providers: ${Object.keys(PROVIDER_ENABLED_KEYS).join(', ')}` },
        { status: 400 }
      );
    }

    // Read existing .env
    const content = await readFile(ENV_PATH, 'utf-8').catch(() => '');
    const vars = parseEnvFile(content);

    // Set or remove the enabled flag
    if (enabled === false) {
      vars[enabledKey] = 'false';
    } else {
      // Remove the key entirely when enabled (default is true)
      delete vars[enabledKey];
    }

    // Write back
    await writeFile(ENV_PATH, serializeEnvFile(vars), 'utf-8');

    // Trigger gateway restart
    try {
      await fetch(`http://localhost:18789/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'provider-toggle-updated' }),
      }).catch(() => {});
    } catch {
      // Silent
    }

    return NextResponse.json({
      ok: true,
      provider,
      enabled: enabled !== false,
      message: `${provider} ${enabled !== false ? 'enabled' : 'disabled'}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to toggle provider', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    
    if (!provider) {
      return NextResponse.json({ error: 'Missing "provider" query parameter' }, { status: 400 });
    }
    
    const envVar = PROVIDER_KEYS[provider];
    if (!envVar) {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}` },
        { status: 400 }
      );
    }
    
    // Read existing .env
    const content = await readFile(ENV_PATH, 'utf-8').catch(() => '');
    const vars = parseEnvFile(content);
    
    // Remove the key and enabled flag
    delete vars[envVar];
    const enabledKey = PROVIDER_ENABLED_KEYS[provider];
    if (enabledKey) delete vars[enabledKey];
    
    // Write back
    await writeFile(ENV_PATH, serializeEnvFile(vars), 'utf-8');
    
    return NextResponse.json({
      ok: true,
      provider,
      message: `${provider} credentials removed.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete provider credentials', detail: String(error) },
      { status: 500 }
    );
  }
}
