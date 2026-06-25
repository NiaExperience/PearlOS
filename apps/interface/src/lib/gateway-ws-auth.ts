type GatewayWsTokenResponse = {
  token: string;
  expiresAt: number;
  sessionId: string;
};

export type GatewayWsAuth = {
  url: string;
  protocols: string[];
  sessionId: string;
  expiresAt: number;
};

type GatewayWsAuthOptions = {
  sessionId?: string | null;
  tenantId?: string | null;
  signal?: AbortSignal;
};

let cachedAuth: (GatewayWsAuth & { key: string; token: string }) | null = null;

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cacheKey(options: GatewayWsAuthOptions): string {
  return `${clean(options.tenantId)}:${clean(options.sessionId)}`;
}

function authProtocol(token: string): string {
  return `pearlos-gateway-auth.${token}`;
}

export async function getGatewayWsAuth(wsUrl: string, options: GatewayWsAuthOptions = {}): Promise<GatewayWsAuth> {
  const key = cacheKey(options);
  const now = Date.now();
  if (cachedAuth && cachedAuth.key === key && cachedAuth.expiresAt - now > 15_000) {
    return {
      url: wsUrl,
      protocols: [authProtocol(cachedAuth.token)],
      sessionId: cachedAuth.sessionId,
      expiresAt: cachedAuth.expiresAt,
    };
  }

  const params = new URLSearchParams();
  const sessionId = clean(options.sessionId);
  const tenantId = clean(options.tenantId);
  if (sessionId) params.set('sessionId', sessionId);
  if (tenantId) params.set('tenantId', tenantId);

  const response = await fetch(`/api/bot/ws-token${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`gateway_ws_token_failed:${response.status}`);
  }

  const body = await response.json() as Partial<GatewayWsTokenResponse>;
  if (!body.token || !body.sessionId || typeof body.expiresAt !== 'number') {
    throw new Error('gateway_ws_token_invalid');
  }

  const auth = {
    key,
    token: body.token,
    url: wsUrl,
    protocols: [authProtocol(body.token)],
    sessionId: body.sessionId,
    expiresAt: body.expiresAt,
  };
  cachedAuth = auth;
  return {
    url: auth.url,
    protocols: auth.protocols,
    sessionId: auth.sessionId,
    expiresAt: auth.expiresAt,
  };
}
