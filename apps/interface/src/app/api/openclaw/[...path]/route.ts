/**
 * OpenClaw Gateway Proxy
 * Proxies all requests to http://localhost:18789/{path}
 */
import { NextRequest, NextResponse } from 'next/server';

const OPENCLAW_BASE = process.env.OPENCLAW_GATEWAY_URL ?? 'http://localhost:18789';

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const targetPath = path.join('/');
  const url = new URL(request.url);
  const queryString = url.search;
  const target = `${OPENCLAW_BASE}/${targetPath}${queryString}`;

  const headers: Record<string, string> = {
    'Accept': request.headers.get('accept') || 'application/json',
  };

  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  const auth = request.headers.get('authorization');
  if (auth) headers['Authorization'] = auth;

  try {
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(30000),
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = await request.text();
    }

    const response = await fetch(target, fetchOptions);

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'OpenClaw gateway unreachable', detail: String(error) },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
