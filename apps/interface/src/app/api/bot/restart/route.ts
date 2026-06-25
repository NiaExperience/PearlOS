import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { isBlairActor } from '@interface/lib/workspace-entitlements';

const BOT_GATEWAY_URL = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';
const DEFAULT_GATEWAY_BIND_HOST = '127.0.0.1';

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

function resolveGatewayBindHost(): string {
  const host = (process.env.BOT_GATEWAY_BIND_HOST || DEFAULT_GATEWAY_BIND_HOST).trim();
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    throw new Error(`Unsafe bot gateway bind host: ${host}`);
  }
  return host;
}

/**
 * POST /api/bot/restart
 * Restarts the Pipecat bot gateway by hitting its internal restart endpoint,
 * or falling back to a process-level restart via shell.
 */
export async function POST(request: NextRequest) {
  const authError = await requirePlatformAdmin(request);
  if (authError) return authError;

  try {
    // Try graceful restart via gateway's own endpoint first
    try {
      const res = await fetch(`${BOT_GATEWAY_URL}/restart`, { method: 'POST', signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        return NextResponse.json({ success: true, method: 'graceful', message: 'Bot gateway restarting...' });
      }
    } catch {
      // Endpoint doesn't exist, fall through to shell restart
    }

    // Shell-level restart: kill existing and respawn
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Kill existing bot gateway
    try {
      await execAsync('pkill -f "uvicorn bot_gateway"');
    } catch {
      // May not be running, that's fine
    }

    // Wait for port to free
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Respawn with env from .env file
    const botDir = '/workspace/nia-universal/apps/pipecat-daily-bot/bot';
    const bindHost = resolveGatewayBindHost();
    const cmd = `cd ${botDir} && nohup python3 -m uvicorn bot_gateway:app --host ${bindHost} --port 4444 > /tmp/bot_gateway.log 2>&1 &`;
    
    await execAsync(cmd, {
      env: {
        ...process.env,
      },
    });

    // Verify it came up
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const health = await fetch(`${BOT_GATEWAY_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (health.ok) {
        return NextResponse.json({ success: true, method: 'shell', message: 'Bot gateway restarted successfully.' });
      }
    } catch {
      // Health check failed but process may still be starting
    }

    return NextResponse.json({ success: true, method: 'shell', message: 'Bot gateway restart initiated. May take a few seconds.' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
