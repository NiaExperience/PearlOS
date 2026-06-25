import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { isTestModeBypassAllowed } from '@interface/lib/api-auth';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_model_advisor]');

const OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'c29b81e25840c89c64074b4d93a7a9b8227a0742aa5a5442';

export async function POST(req: NextRequest) {
  try {
    // Check authentication — bypass in test mode (same pattern as model-settings)
    const testMode = isTestModeBypassAllowed();
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!testMode && !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const res = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
      },
      body: JSON.stringify({
        model: 'openrouter/anthropic/claude-sonnet-4.5',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      log.error('OpenClaw API error', { status: res.status, body: text });
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log.error('No JSON in AI response', { preview: content.slice(0, 200) });
      return NextResponse.json({ error: 'Invalid AI response' }, { status: 502 });
    }

    const tiers = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ tiers });
  } catch (err) {
    log.error('Model advisor error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }
}
