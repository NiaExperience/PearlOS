import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { TenantRole, type IUserTenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { getServerSession } from 'next-auth';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { verifyBotClaimHeaders, type BotClaims } from '@interface/lib/bot-auth-claims';

type SessionUser = {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  tenantId?: unknown;
  tenant_id?: unknown;
};

export type InterfaceActorContext = {
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string;
  tenantRole: TenantRole;
  authSource: 'next-auth-session' | 'bot-signed-claims';
  actorType: 'user' | 'service' | 'channel';
};

export type ResolveActorContextOptions = {
  request?: Pick<NextRequest, 'headers'>;
  requestedTenantId?: unknown;
  minimumRole?: TenantRole;
  allowServiceClaims?: boolean;
  allowPersonalWorkspaceFallback?: boolean;
};

export type ResolveActorContextResult =
  | { ok: true; actor: InterfaceActorContext }
  | { ok: false; response: NextResponse };

const ROLE_RANK: Record<TenantRole, number> = {
  [TenantRole.MEMBER]: 1,
  [TenantRole.ADMIN]: 2,
  [TenantRole.OWNER]: 3,
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanEmail(value: unknown): string {
  return cleanString(value).toLowerCase();
}

function roleMeetsMinimum(role: TenantRole, minimumRole: TenantRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

function sessionTenantIds(sessionUser: SessionUser): string[] {
  const ids = [
    cleanString(sessionUser.tenantId),
    cleanString(sessionUser.tenant_id),
  ].filter(Boolean);
  return Array.from(new Set(ids));
}

function roleForTenant(
  roles: IUserTenantRole[],
  tenantId: string,
  minimumRole: TenantRole,
): IUserTenantRole | null {
  return roles.find((role) =>
    role.tenantId === tenantId &&
    Object.values(TenantRole).includes(role.role) &&
    roleMeetsMinimum(role.role, minimumRole)
  ) ?? null;
}

function firstAllowedRole(
  roles: IUserTenantRole[],
  minimumRole: TenantRole,
): IUserTenantRole | null {
  return roles.find((role) =>
    Boolean(role.tenantId) &&
    Object.values(TenantRole).includes(role.role) &&
    roleMeetsMinimum(role.role, minimumRole)
  ) ?? null;
}

function jsonError(error: string, status: number): ResolveActorContextResult {
  return {
    ok: false,
    response: NextResponse.json({ error }, { status }),
  };
}

function actorFromRole(params: {
  userId: string;
  userEmail: string;
  userName: string;
  role: IUserTenantRole;
  authSource: InterfaceActorContext['authSource'];
  actorType: InterfaceActorContext['actorType'];
}): InterfaceActorContext {
  return {
    userId: params.userId,
    userEmail: params.userEmail,
    userName: params.userName,
    tenantId: params.role.tenantId,
    tenantRole: params.role.role,
    authSource: params.authSource,
    actorType: params.actorType,
  };
}

function personalWorkspaceFallbackActor(params: {
  userId: string;
  userEmail: string;
  userName: string;
  sessionUser: SessionUser;
}): InterfaceActorContext {
  const tenantId =
    sessionTenantIds(params.sessionUser)[0] ||
    cleanString(process.env.DEFAULT_TENANT_ID) ||
    'personal';
  return {
    userId: params.userId,
    userEmail: params.userEmail,
    userName: params.userName,
    tenantId,
    tenantRole: TenantRole.MEMBER,
    authSource: 'next-auth-session',
    actorType: 'user',
  };
}

async function resolveServiceClaimsActor(
  claims: BotClaims,
  options: ResolveActorContextOptions,
): Promise<ResolveActorContextResult> {
  const requestedTenantId = cleanString(options.requestedTenantId);
  if (requestedTenantId && requestedTenantId !== claims.tenantId) {
    return jsonError('tenant_forbidden', 403);
  }

  let roles: IUserTenantRole[];
  try {
    roles = await getUserTenantRoles(claims.sessionUserId);
  } catch {
    return jsonError('tenant_forbidden', 403);
  }

  const minimumRole = options.minimumRole ?? TenantRole.MEMBER;
  const tenantRole = roleForTenant(roles, claims.tenantId, minimumRole);
  if (!tenantRole) {
    return jsonError('tenant_forbidden', 403);
  }

  return {
    ok: true,
    actor: actorFromRole({
      userId: claims.sessionUserId,
      userEmail: cleanEmail(claims.sessionUserEmail),
      userName: cleanString(claims.sessionUserName),
      role: tenantRole,
      authSource: 'bot-signed-claims',
      actorType: 'service',
    }),
  };
}

export async function resolveInterfaceActorContext(
  options: ResolveActorContextOptions = {},
): Promise<ResolveActorContextResult> {
  if (options.allowServiceClaims && options.request?.headers) {
    const hasClaimHeaders =
      options.request.headers.has('x-bot-claims-ts') ||
      options.request.headers.has('x-bot-claims') ||
      options.request.headers.has('x-bot-claims-sig');
    const claimResult = verifyBotClaimHeaders(options.request.headers);
    if (claimResult.ok) {
      return resolveServiceClaimsActor(claimResult.claims, options);
    }
    if (hasClaimHeaders) {
      return jsonError(claimResult.error, 401);
    }
  }

  const session = await getServerSession(interfaceAuthOptions);
  const sessionUser = (session?.user ?? {}) as SessionUser;
  const userId = cleanString(sessionUser.id);
  const userEmail = cleanEmail(sessionUser.email);
  const userName = cleanString(sessionUser.name);

  if (!userId || !userEmail) {
    return jsonError('Unauthorized', 401);
  }

  let roles: IUserTenantRole[];
  try {
    roles = await getUserTenantRoles(userId);
  } catch {
    return jsonError('tenant_forbidden', 403);
  }

  const minimumRole = options.minimumRole ?? TenantRole.MEMBER;
  const requestedTenantId = cleanString(options.requestedTenantId);

  if (requestedTenantId) {
    const requestedRole = roleForTenant(roles, requestedTenantId, minimumRole);
    if (!requestedRole) {
      return jsonError('tenant_forbidden', 403);
    }
    return {
      ok: true,
      actor: actorFromRole({
        userId,
        userEmail,
        userName,
        role: requestedRole,
        authSource: 'next-auth-session',
        actorType: 'user',
      }),
    };
  }

  for (const tenantId of sessionTenantIds(sessionUser)) {
    const sessionRole = roleForTenant(roles, tenantId, minimumRole);
    if (sessionRole) {
      return {
        ok: true,
        actor: actorFromRole({
          userId,
          userEmail,
          userName,
          role: sessionRole,
          authSource: 'next-auth-session',
          actorType: 'user',
        }),
      };
    }
  }

  const fallbackRole = firstAllowedRole(roles, minimumRole);
  if (fallbackRole) {
    return {
      ok: true,
      actor: actorFromRole({
        userId,
        userEmail,
        userName,
        role: fallbackRole,
        authSource: 'next-auth-session',
        actorType: 'user',
      }),
    };
  }

  if (options.allowPersonalWorkspaceFallback && minimumRole === TenantRole.MEMBER) {
    return {
      ok: true,
      actor: personalWorkspaceFallbackActor({ userId, userEmail, userName, sessionUser }),
    };
  }

  return jsonError('tenant_required', 403);
}
