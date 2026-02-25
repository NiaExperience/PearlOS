import { NextResponse } from 'next/server';

const BOT_GATEWAY_URL = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';

/**
 * POST /api/bot/restart
 * Restarts the Pipecat bot gateway by hitting its internal restart endpoint,
 * or falling back to a process-level restart via shell.
 */
export async function POST() {
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
    const cmd = `cd ${botDir} && nohup python3 -m uvicorn bot_gateway:app --host 0.0.0.0 --port 4444 > /tmp/bot_gateway.log 2>&1 &`;
    
    await execAsync(cmd, {
      env: {
        ...process.env,
        USE_ELEVENLABS: 'false',
        BOT_TTS_PROVIDER: 'pocket',
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
