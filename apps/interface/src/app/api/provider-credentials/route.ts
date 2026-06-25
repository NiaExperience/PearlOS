import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { isBlairActor } from '@interface/lib/workspace-entitlements';

const ENV_PATH = '/root/.openclaw/.env';

interface ProviderCredentials {
  [key: string]: {
    apiKey: string;
    enabled: boolean;
  };
}

async function requirePlatformAdmin(request: NextRequest): Promise<NextResponse | null> {
  const actorResult = await resolveInterfaceActorContext({
    request,
    minimumRole: TenantRole.ADMIN,
  });
  if (!actorResult.ok) return actorResult.response;
  if (!isBlairActor(actorResult.actor)) {
    return NextResponse.json({ error: 'platform_admin_required' }, { status: 403 });
  }
  return null;
}

// Parse .env file into key-value pairs
async function parseEnvFile(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    const env: Record<string, string> = {};
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Remove surrounding quotes if present
        env[key] = value.replace(/^['"]|['"]$/g, '');
      }
    }
    
    return env;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

// Write env vars back to .env file
async function writeEnvFile(env: Record<string, string>): Promise<void> {
  const lines = Object.entries(env).map(([key, value]) => {
    // Quote values that contain special chars
    const needsQuotes = /[\s#]/.test(value);
    return `${key}=${needsQuotes ? `'${value}'` : value}`;
  });
  
  await fs.mkdir(path.dirname(ENV_PATH), { recursive: true });
  await fs.writeFile(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

// GET: List provider credentials status
export async function GET(request: NextRequest) {
  const authError = await requirePlatformAdmin(request);
  if (authError) return authError;
  try {
    const env = await parseEnvFile();
    
    const providers = {
      anthropic: {
        hasKey: !!env.ANTHROPIC_API_KEY,
        keyPreview: env.ANTHROPIC_API_KEY ? maskApiKey(env.ANTHROPIC_API_KEY) : null,
      },
      openai: {
        hasKey: !!env.OPENAI_API_KEY,
        keyPreview: env.OPENAI_API_KEY ? maskApiKey(env.OPENAI_API_KEY) : null,
      },
      openrouter: {
        hasKey: !!env.OPENROUTER_API_KEY,
        keyPreview: env.OPENROUTER_API_KEY ? maskApiKey(env.OPENROUTER_API_KEY) : null,
      },
      xai: {
        hasKey: !!env.XAI_API_KEY,
        keyPreview: env.XAI_API_KEY ? maskApiKey(env.XAI_API_KEY) : null,
      },
      groq: {
        hasKey: !!env.GROQ_API_KEY,
        keyPreview: env.GROQ_API_KEY ? maskApiKey(env.GROQ_API_KEY) : null,
      },
      google: {
        hasKey: !!env.GOOGLE_API_KEY,
        keyPreview: env.GOOGLE_API_KEY ? maskApiKey(env.GOOGLE_API_KEY) : null,
      },
      mistral: {
        hasKey: !!env.MISTRAL_API_KEY,
        keyPreview: env.MISTRAL_API_KEY ? maskApiKey(env.MISTRAL_API_KEY) : null,
      },
      deepseek: {
        hasKey: !!env.DEEPSEEK_API_KEY,
        keyPreview: env.DEEPSEEK_API_KEY ? maskApiKey(env.DEEPSEEK_API_KEY) : null,
      },
    };
    
    return NextResponse.json({ providers });
  } catch (error: any) {
    console.error('[provider-credentials] GET error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// POST: Add or update provider credentials
export async function POST(request: NextRequest) {
  const authError = await requirePlatformAdmin(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { provider, apiKey } = body;
    
    if (!provider || !apiKey) {
      return NextResponse.json(
        { error: 'Provider and apiKey are required' },
        { status: 400 }
      );
    }
    
    const validProviders = ['anthropic', 'openai', 'openrouter', 'xai', 'groq', 'google', 'mistral', 'deepseek'];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` },
        { status: 400 }
      );
    }
    
    const env = await parseEnvFile();
    
    // Map provider to env var name
    const envVarMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      xai: 'XAI_API_KEY',
      groq: 'GROQ_API_KEY',
      google: 'GOOGLE_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
    };
    
    const envVarName = envVarMap[provider];
    env[envVarName] = apiKey;
    
    await writeEnvFile(env);
    
    return NextResponse.json({
      success: true,
      provider,
      keyPreview: maskApiKey(apiKey),
    });
  } catch (error: any) {
    console.error('[provider-credentials] POST error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// DELETE: Remove provider credentials
export async function DELETE(request: NextRequest) {
  const authError = await requirePlatformAdmin(request);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    
    if (!provider) {
      return NextResponse.json(
        { error: 'Provider parameter is required' },
        { status: 400 }
      );
    }
    
    const env = await parseEnvFile();
    
    const envVarMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      xai: 'XAI_API_KEY',
      groq: 'GROQ_API_KEY',
      google: 'GOOGLE_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
    };
    
    const envVarName = envVarMap[provider];
    if (envVarName && env[envVarName]) {
      delete env[envVarName];
      await writeEnvFile(env);
    }
    
    return NextResponse.json({ success: true, provider });
  } catch (error: any) {
    console.error('[provider-credentials] DELETE error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 8) + '••••' + key.slice(-4);
}
