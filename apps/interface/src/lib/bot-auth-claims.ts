import crypto from 'crypto';

export type BotClaims = {
  tenantId: string;
  sessionUserId: string;
  sessionId: string;
  sessionUserEmail?: string;
  sessionUserName?: string;
};

type GatewayWsTokenClaims = BotClaims & {
  allowedScopes?: string[];
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signingSecret(): string {
  const sharedSecret = process.env.BOT_CONTROL_CLAIMS_SECRET || process.env.BOT_CONTROL_SHARED_SECRET;
  if (!sharedSecret) {
    throw new Error('Missing bot claims signing secret');
  }
  return sharedSecret;
}

function claimsPayload(claims: BotClaims): string {
  return JSON.stringify({
    tenantId: claims.tenantId,
    sessionUserId: claims.sessionUserId,
    sessionId: claims.sessionId,
    sessionUserEmail: claims.sessionUserEmail || '',
    sessionUserName: claims.sessionUserName || '',
  });
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createBotClaimHeaders(claims: BotClaims): Record<string, string> {
  const sharedSecret = signingSecret();

  const timestamp = String(Date.now());
  const payload = claimsPayload(claims);

  const signature = crypto
    .createHmac('sha256', sharedSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  return {
    'x-bot-claims-ts': timestamp,
    'x-bot-claims': payload,
    'x-bot-claims-sig': signature,
  };
}

export type VerifyBotClaimHeadersResult =
  | { ok: true; claims: BotClaims }
  | { ok: false; error: 'missing_bot_claims' | 'stale_bot_claims' | 'invalid_bot_claims_payload' | 'invalid_bot_claims_signature' };

export function verifyBotClaimHeaders(
  headers: Headers,
  options: { maxAgeMs?: number } = {},
): VerifyBotClaimHeadersResult {
  const timestamp = cleanString(headers.get('x-bot-claims-ts'));
  const payload = cleanString(headers.get('x-bot-claims'));
  const signature = cleanString(headers.get('x-bot-claims-sig'));
  if (!timestamp || !payload || !signature) {
    return { ok: false, error: 'missing_bot_claims' };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > (options.maxAgeMs ?? 300_000)) {
    return { ok: false, error: 'stale_bot_claims' };
  }

  let claims: BotClaims;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    claims = {
      tenantId: cleanString(parsed.tenantId),
      sessionUserId: cleanString(parsed.sessionUserId),
      sessionId: cleanString(parsed.sessionId),
      sessionUserEmail: cleanString(parsed.sessionUserEmail),
      sessionUserName: cleanString(parsed.sessionUserName),
    };
  } catch {
    return { ok: false, error: 'invalid_bot_claims_payload' };
  }

  if (!claims.tenantId || !claims.sessionUserId || !claims.sessionId || !claims.sessionUserEmail) {
    return { ok: false, error: 'invalid_bot_claims_payload' };
  }

  const expectedSignature = crypto
    .createHmac('sha256', signingSecret())
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  if (!timingSafeEqual(expectedSignature, signature)) {
    return { ok: false, error: 'invalid_bot_claims_signature' };
  }

  return { ok: true, claims };
}

export function createGatewayWsToken(claims: GatewayWsTokenClaims, ttlMs = 90_000): { token: string; expiresAt: number } {
  const sharedSecret = signingSecret();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const allowedScopes = Array.from(new Set([
    claims.sessionId,
    claims.sessionUserId,
    ...(claims.allowedScopes || []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())))
    .sort();

  const body = encodeBase64Url(JSON.stringify({
    purpose: 'gateway-ws',
    tenantId: claims.tenantId,
    sessionUserId: claims.sessionUserId,
    sessionId: claims.sessionId,
    sessionUserEmail: claims.sessionUserEmail || '',
    sessionUserName: claims.sessionUserName || '',
    allowedScopes,
    iat: now,
    exp: expiresAt,
  }));

  const signature = crypto
    .createHmac('sha256', sharedSecret)
    .update(body)
    .digest('hex');

  return {
    token: `${body}.${signature}`,
    expiresAt,
  };
}
