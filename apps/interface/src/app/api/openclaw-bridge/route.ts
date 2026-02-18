/**
 * OpenClaw Bridge API Route
 *
 * POST /api/openclaw-bridge
 *   Body: { prompt, assistantId, conversationId?, workspacePath? }
 *   Proxies to OpenClaw's /v1/chat/completions endpoint and returns SSE stream
 *
 * GET /api/openclaw-bridge
 *   Health check — returns { ok: true } if OpenClaw gateway is reachable
 */

import { NextRequest, NextResponse } from 'next/server';

function getConfig() {
  const apiUrl = process.env.OPENCLAW_API_URL ?? 'http://localhost:3100';
  const apiKey = process.env.OPENCLAW_API_KEY ?? '';
  return { apiUrl, apiKey };
}

export async function GET() {
  const { apiUrl } = getConfig();
  try {
    const res = await fetch(`${apiUrl}/health`, { method: 'GET' });
    return NextResponse.json({ ok: res.ok });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { prompt, assistantId, conversationId } = body;

  if (!prompt) {
    return NextResponse.json(
      { error: 'prompt is required' },
      { status: 400 }
    );
  }

  const { apiUrl, apiKey } = getConfig();

  // Stream response via SSE by proxying to OpenClaw's /v1/chat/completions
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(`${apiUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            stream: true,
          }),
        });

        if (!response.ok || !response.body) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', content: `OpenClaw API error: ${response.status}` })}\n\n`
            )
          );
          controller.close();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const content = parsed?.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'text', content })}\n\n`)
                  );
                }
              } catch {
                // Skip malformed chunks
              }
            }
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', content: msg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
