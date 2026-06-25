import { NextResponse } from 'next/server';

interface ServiceResult {
  name: string;
  status: 'ok' | 'error';
  detail?: string;
}

async function checkService(name: string, url: string, timeout = 5000): Promise<ServiceResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { name, status: res.ok ? 'ok' : 'error', detail: `HTTP ${res.status}` };
  } catch (err: any) {
    return { name, status: 'error', detail: err.message || 'unreachable' };
  }
}

async function checkServiceGraphQL(name: string, url: string, timeout = 5000): Promise<ServiceResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 401 means service is running but requires auth - that's OK for a health check
    const isHealthy = res.ok || res.status === 401;
    return { name, status: isHealthy ? 'ok' : 'error', detail: `HTTP ${res.status}` };
  } catch (err: any) {
    return { name, status: 'error', detail: err.message || 'unreachable' };
  }
}

export async function GET() {
  const results = await Promise.all([
    Promise.resolve({ name: 'Next.js Interface', status: 'ok' as const, detail: 'serving' }), // implicitly healthy if this runs
    checkService('OpenClaw Gateway', 'http://localhost:18789/health'),
    checkServiceGraphQL('Mesh GraphQL', 'http://localhost:2000/graphql'),
    checkService('Bot Gateway (Pipecat)', 'http://localhost:4444/health'),
    checkService('PocketTTS (Azelma)', 'http://localhost:8766/healthz'),
  ]);

  return NextResponse.json({ services: results });
}
