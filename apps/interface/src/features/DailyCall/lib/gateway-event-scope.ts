type JsonRecord = Record<string, unknown>;

export interface GatewayScope {
  tenantId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
}

export interface GatewayEnvelopeLike {
  tenant_id?: unknown;
  tenantId?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  targetSessionUserId?: unknown;
  user_id?: unknown;
  userId?: unknown;
  sessionUserId?: unknown;
  payload?: unknown;
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function roomNameFromUrl(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    const parts = raw.split('/').filter(Boolean);
    return parts[parts.length - 1] || raw;
  }
}

function matchesAny(candidate: string | null, expected: Array<string | null>): boolean {
  return !!candidate && expected.some((item) => !!item && item === candidate);
}

export function shouldAcceptGatewayEnvelope(envelope: GatewayEnvelopeLike, scope: GatewayScope): boolean {
  const currentTenantId = clean(scope.tenantId);
  const currentSessionId = clean(scope.sessionId);
  const currentUserId = clean(scope.userId);
  if (!currentSessionId && !currentUserId) return false;

  const payload = asRecord(envelope.payload);
  const envelopeTenantId =
    clean(envelope.tenant_id) ||
    clean(envelope.tenantId) ||
    clean(payload.tenant_id) ||
    clean(payload.tenantId) ||
    clean(payload.requester_tenant_id) ||
    clean(payload.requesterTenantId);
  if (envelopeTenantId && envelopeTenantId !== currentTenantId) return false;

  const targetUserId = clean(envelope.targetSessionUserId) || clean(payload.targetSessionUserId);
  if (targetUserId) return targetUserId === currentUserId;

  const envelopeUserId =
    clean(envelope.user_id) ||
    clean(envelope.userId) ||
    clean(envelope.sessionUserId) ||
    clean(payload.user_id) ||
    clean(payload.userId) ||
    clean(payload.sessionUserId) ||
    clean(payload.requester_user_id) ||
    clean(payload.requesterUserId);
  if (envelopeUserId) return envelopeUserId === currentUserId;

  const envelopeSessionId =
    clean(envelope.session_id) ||
    clean(envelope.sessionId) ||
    clean(payload.session_id) ||
    clean(payload.sessionId) ||
    roomNameFromUrl(payload.room_url) ||
    roomNameFromUrl(payload.roomUrl);
  if (envelopeSessionId) {
    return matchesAny(envelopeSessionId, [currentSessionId, currentUserId]);
  }

  // Legacy unscoped gateway broadcasts are intentionally not routed here.
  // Chat-mode tools perform their local UI action before asking the gateway
  // to mirror it, so accepting unscoped echoes is only a leak/duplicate risk.
  return false;
}

export function gatewaySubscriptionScope(scope: GatewayScope): string | null {
  return clean(scope.sessionId) || clean(scope.userId);
}
