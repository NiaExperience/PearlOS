import { createHash, randomBytes } from 'node:crypto';

import {
  createAccount,
  deleteAccount,
  getAccountByProviderAccountId,
  getAccounts,
  getUserAccountByProvider,
  updateAccount,
} from '@nia/prism/core/actions/account-actions';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import type { IAccount } from '@nia/prism/core/blocks/account.block';

const GOOGLE_CHAT_PROVIDER = 'google-chat';
const GOOGLE_PROVIDER = 'google';
const CODE_TTL_MS = 10 * 60 * 1000;

type GoogleChatScope =
  | {
      status: 'pending';
      codeHash: string;
      issuedAt: string;
      expiresAt: string;
      expectedGoogleEmail: string;
      expectedGoogleProviderAccountId: string;
      tenantId: string;
    }
  | {
      status: 'linked';
      googleChatUserName: string;
      googleChatDisplayName?: string | null;
      googleChatUserEmail: string;
      googleProviderAccountId: string;
      googleChatSpaceName?: string | null;
      googleChatSpaceUri?: string | null;
      tenantId: string;
      verifiedAt: string;
    };

export type GoogleChatLinkStatus =
  | { linked: false; pending: false }
  | { linked: false; pending: true; expiresAt: string }
  | {
      linked: true;
      googleChatUserName: string;
      googleChatDisplayName?: string | null;
      googleChatUserEmail?: string | null;
      googleChatSpaceName?: string | null;
      googleChatSpaceUri?: string | null;
      verifiedAt: string;
    };

export type GoogleChatLinkedAccountScope = {
  googleChatUserName: string;
  googleChatUserEmail: string;
  googleChatSpaceName?: string | null;
  googleChatSpaceUri?: string | null;
  userId: string;
  email: string;
  userName: string;
  tenantId: string;
};

export type GoogleChatConsumeResult =
  | (Extract<GoogleChatLinkStatus, { linked: true }> & { reason?: undefined })
  | { linked: false; reason: 'expired_or_invalid' | 'google_chat_user_missing' | 'google_account_mismatch' | 'google_chat_email_missing' };

export type RequiredGoogleChatIdentity = {
  userId: string;
  email: string;
  userName: string;
  googleProviderAccountId: string;
  tenantId: string;
};

export type GoogleChatAppMetadata = {
  chatAppName: string;
  chatAppUrl: string | null;
};

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function parseScope(value: unknown): GoogleChatScope | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GoogleChatScope>;
    if (
      parsed.status === 'pending' &&
      parsed.codeHash &&
      parsed.expiresAt &&
      parsed.expectedGoogleEmail &&
      parsed.expectedGoogleProviderAccountId &&
      parsed.tenantId
    ) {
      return parsed as GoogleChatScope;
    }
    if (
      parsed.status === 'linked' &&
      parsed.googleChatUserName &&
      parsed.googleChatUserEmail &&
      parsed.googleProviderAccountId &&
      parsed.tenantId &&
      parsed.verifiedAt
    ) {
      return parsed as GoogleChatScope;
    }
  } catch {
    return null;
  }
  return null;
}

function serializeScope(scope: GoogleChatScope): string {
  return JSON.stringify(scope);
}

function isGoogleChatUserName(value: string): boolean {
  return /^users\/[A-Za-z0-9._-]+$/.test(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown): string {
  const text = cleanString(value).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? text : '';
}

function configuredPublicTenantId(): string {
  return cleanString(process.env.GOOGLE_CHAT_PUBLIC_TENANT_ID);
}

export function googleChatAppMetadata(): GoogleChatAppMetadata {
  return {
    chatAppName: cleanString(process.env.GOOGLE_CHAT_APP_NAME) || 'Pearl',
    chatAppUrl: cleanString(process.env.GOOGLE_CHAT_APP_URL) || null,
  };
}

export function googleChatMissingConfigReasons(): string[] {
  const reasons: string[] = [];
  if (process.env.GOOGLE_CHAT_ENABLED !== '1') reasons.push('google_chat_disabled');
  if (!configuredPublicTenantId()) reasons.push('google_chat_public_tenant_missing');
  return reasons;
}

export function googleChatIsConfigured(): boolean {
  return googleChatMissingConfigReasons().length === 0;
}

export function normalizeGoogleChatUserName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return isGoogleChatUserName(text) ? text : '';
}

export function normalizeGoogleChatSpaceName(value: unknown): string {
  const text = cleanString(value);
  return /^spaces\/[A-Za-z0-9._-]+$/.test(text) ? text : '';
}

export function normalizeGoogleChatCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9]{6,8}$/.test(code) ? code : '';
}

export function extractGoogleChatLinkCode(text: string): string {
  const trimmed = text.trim().toUpperCase();
  const linkMatch = trimmed.match(/^LINK(?:\s+ME)?\s+([A-Z0-9]{6,8})$/);
  if (linkMatch) return linkMatch[1];
  return /^[A-Z0-9]{6,8}$/.test(trimmed) ? trimmed : '';
}

export function createGoogleChatLinkCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function googleChatAccountByUser(userId: string): Promise<IAccount | null> {
  return (await getUserAccountByProvider(userId, GOOGLE_CHAT_PROVIDER)) as IAccount | null;
}

export async function requireGoogleChatPearlOsIdentity(userId: string): Promise<RequiredGoogleChatIdentity> {
  if (!userId) throw new Error('userId required');
  const tenantId = configuredPublicTenantId();
  if (!tenantId) throw new Error('google_chat_public_tenant_missing');

  const user = await getUserById(userId);
  const email = normalizeEmail(user?.email);
  if (!email) throw new Error('google_account_required');

  const googleAccount = (await getUserAccountByProvider(userId, GOOGLE_PROVIDER)) as IAccount | null;
  const googleProviderAccountId = cleanString(googleAccount?.providerAccountId);
  if (!googleProviderAccountId) throw new Error('google_account_required');

  const roles = await getUserTenantRoles(userId);
  const hasPublicTenant = roles.some((role) => cleanString(role?.tenantId) === tenantId);
  if (!hasPublicTenant) throw new Error('google_chat_public_tenant_required');

  const userName = cleanString(user?.name) || email;
  return {
    userId,
    email,
    userName,
    googleProviderAccountId,
    tenantId,
  };
}

export async function getGoogleChatLinkStatusForUser(userId: string): Promise<GoogleChatLinkStatus> {
  const account = await googleChatAccountByUser(userId);
  if (!account) return { linked: false, pending: false };
  const scope = parseScope(account.scope);
  if (scope?.status === 'linked') {
    return {
      linked: true,
      googleChatUserName: scope.googleChatUserName,
      googleChatDisplayName: scope.googleChatDisplayName ?? null,
      googleChatUserEmail: scope.googleChatUserEmail,
      googleChatSpaceName: scope.googleChatSpaceName ?? null,
      googleChatSpaceUri: scope.googleChatSpaceUri ?? null,
      verifiedAt: scope.verifiedAt,
    };
  }
  if (scope?.status === 'pending' && new Date(scope.expiresAt).getTime() > Date.now()) {
    return { linked: false, pending: true, expiresAt: scope.expiresAt };
  }
  return { linked: false, pending: false };
}

export async function requestGoogleChatLinkCode(userId: string): Promise<{ code: string; expiresAt: string; pearlOsGoogleEmail: string }> {
  const identity = await requireGoogleChatPearlOsIdentity(userId);
  const code = createGoogleChatLinkCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  const payload: IAccount = {
    userId: identity.userId,
    provider: GOOGLE_CHAT_PROVIDER,
    providerAccountId: `pending:${identity.userId}`,
    type: 'google_chat_link',
    scope: serializeScope({
      status: 'pending',
      codeHash: hashCode(code),
      issuedAt: now.toISOString(),
      expiresAt,
      expectedGoogleEmail: identity.email,
      expectedGoogleProviderAccountId: identity.googleProviderAccountId,
      tenantId: identity.tenantId,
    }),
  };

  const existing = await googleChatAccountByUser(identity.userId);
  if (existing?._id) {
    await updateAccount(existing._id, payload);
  } else {
    await createAccount(payload);
  }
  return { code, expiresAt, pearlOsGoogleEmail: identity.email };
}

export async function consumeGoogleChatLinkCode(input: {
  code: string;
  googleChatUserName: string;
  googleChatDisplayName?: string | null;
  googleChatUserEmail?: string | null;
  googleChatSpaceName?: string | null;
  googleChatSpaceUri?: string | null;
}): Promise<GoogleChatConsumeResult> {
  const code = normalizeGoogleChatCode(input.code);
  const googleChatUserName = normalizeGoogleChatUserName(input.googleChatUserName);
  const googleChatUserEmail = normalizeEmail(input.googleChatUserEmail);
  const googleChatSpaceName = normalizeGoogleChatSpaceName(input.googleChatSpaceName);
  const googleChatSpaceUri = cleanString(input.googleChatSpaceUri) || null;
  if (!code) return { linked: false, reason: 'expired_or_invalid' };
  if (!googleChatUserName) return { linked: false, reason: 'google_chat_user_missing' };

  const codeHash = hashCode(code);
  const now = Date.now();
  const accounts = await getAccounts();
  const pending = accounts.find((account) => {
    if (account.provider !== GOOGLE_CHAT_PROVIDER || !account._id) return false;
    const scope = parseScope(account.scope);
    return scope?.status === 'pending' &&
      scope.codeHash === codeHash &&
      new Date(scope.expiresAt).getTime() > now;
  });
  if (!pending?._id) return { linked: false, reason: 'expired_or_invalid' };

  const pendingScope = parseScope(pending.scope);
  if (pendingScope?.status !== 'pending') return { linked: false, reason: 'expired_or_invalid' };
  if (!googleChatUserEmail) return { linked: false, reason: 'google_chat_email_missing' };

  const identity = await requireGoogleChatPearlOsIdentity(pending.userId);
  if (
    googleChatUserEmail !== pendingScope.expectedGoogleEmail ||
    identity.email !== pendingScope.expectedGoogleEmail ||
    identity.googleProviderAccountId !== pendingScope.expectedGoogleProviderAccountId ||
    identity.tenantId !== pendingScope.tenantId
  ) {
    return { linked: false, reason: 'google_account_mismatch' };
  }

  const existingForChatUser = await getAccountByProviderAccountId(GOOGLE_CHAT_PROVIDER, googleChatUserName);
  if (existingForChatUser?._id && existingForChatUser._id !== pending._id) {
    await deleteAccount(existingForChatUser._id);
  }

  const verifiedAt = new Date().toISOString();
  const linked = await updateAccount(pending._id, {
    userId: pending.userId,
    provider: GOOGLE_CHAT_PROVIDER,
    providerAccountId: googleChatUserName,
    type: 'google_chat_link',
    scope: serializeScope({
      status: 'linked',
      googleChatUserName,
      googleChatDisplayName: input.googleChatDisplayName ?? null,
      googleChatUserEmail,
      googleProviderAccountId: identity.googleProviderAccountId,
      googleChatSpaceName: googleChatSpaceName || null,
      googleChatSpaceUri,
      tenantId: identity.tenantId,
      verifiedAt,
    }),
  });

  return {
    linked: true,
    googleChatUserName,
    googleChatDisplayName: input.googleChatDisplayName ?? null,
    googleChatUserEmail,
    googleChatSpaceName: googleChatSpaceName || null,
    googleChatSpaceUri,
    verifiedAt: parseScope(linked.scope)?.status === 'linked'
      ? (parseScope(linked.scope) as Extract<GoogleChatScope, { status: 'linked' }>).verifiedAt
      : verifiedAt,
  };
}

export async function linkGoogleChatOauthDm(input: {
  userId: string;
  googleSub: string;
  googleEmail: string;
  googleChatDisplayName?: string | null;
  googleChatSpaceName: string;
  googleChatSpaceUri?: string | null;
}): Promise<Extract<GoogleChatLinkStatus, { linked: true }>> {
  const identity = await requireGoogleChatPearlOsIdentity(input.userId);
  const googleEmail = normalizeEmail(input.googleEmail);
  const googleSub = cleanString(input.googleSub);
  const googleChatSpaceName = normalizeGoogleChatSpaceName(input.googleChatSpaceName);
  const googleChatSpaceUri = cleanString(input.googleChatSpaceUri) || null;
  if (!googleEmail || !googleSub || !googleChatSpaceName) {
    throw new Error('invalid_google_chat_oauth_identity');
  }
  if (googleEmail !== identity.email || googleSub !== identity.googleProviderAccountId) {
    throw new Error('google_account_mismatch');
  }

  const googleChatUserName = `users/${googleSub}`;
  const existingForChatUser = await getAccountByProviderAccountId(GOOGLE_CHAT_PROVIDER, googleChatUserName);
  const existingForUser = await googleChatAccountByUser(identity.userId);
  if (existingForChatUser?._id && existingForUser?._id && existingForChatUser._id !== existingForUser._id) {
    await deleteAccount(existingForChatUser._id);
  }

  const verifiedAt = new Date().toISOString();
  const payload: IAccount = {
    userId: identity.userId,
    provider: GOOGLE_CHAT_PROVIDER,
    providerAccountId: googleChatUserName,
    type: 'google_chat_link',
    scope: serializeScope({
      status: 'linked',
      googleChatUserName,
      googleChatDisplayName: input.googleChatDisplayName ?? identity.userName,
      googleChatUserEmail: googleEmail,
      googleProviderAccountId: googleSub,
      googleChatSpaceName,
      googleChatSpaceUri,
      tenantId: identity.tenantId,
      verifiedAt,
    }),
  };

  let saved: IAccount;
  if (existingForUser?._id) {
    saved = await updateAccount(existingForUser._id, payload);
  } else {
    saved = await createAccount(payload);
  }
  const scope = parseScope(saved.scope);
  if (scope?.status !== 'linked') throw new Error('google_chat_link_persist_failed');

  return {
    linked: true,
    googleChatUserName,
    googleChatDisplayName: scope.googleChatDisplayName ?? null,
    googleChatUserEmail: scope.googleChatUserEmail,
    googleChatSpaceName: scope.googleChatSpaceName ?? null,
    googleChatSpaceUri: scope.googleChatSpaceUri ?? null,
    verifiedAt: scope.verifiedAt,
  };
}

export async function getGoogleChatLinkedAccountScope(
  googleChatUserName: string,
  options: { googleChatUserEmail?: string | null; googleChatSpaceName?: string | null } = {},
): Promise<GoogleChatLinkedAccountScope | null> {
  const normalized = normalizeGoogleChatUserName(googleChatUserName);
  const googleChatUserEmail = normalizeEmail(options.googleChatUserEmail);
  const googleChatSpaceName = normalizeGoogleChatSpaceName(options.googleChatSpaceName);
  if (!normalized && !googleChatUserEmail && !googleChatSpaceName) return null;

  let account = normalized ? await getAccountByProviderAccountId(GOOGLE_CHAT_PROVIDER, normalized) : null;
  let scope = parseScope(account?.scope);
  if (scope?.status !== 'linked' && (googleChatUserEmail || googleChatSpaceName)) {
    const accounts = await getAccounts();
    const match = accounts.find((candidate) => {
      if (candidate.provider !== GOOGLE_CHAT_PROVIDER) return false;
      const candidateScope = parseScope(candidate.scope);
      return candidateScope?.status === 'linked' && (
        (googleChatUserEmail && candidateScope.googleChatUserEmail === googleChatUserEmail) ||
        (googleChatSpaceName && candidateScope.googleChatSpaceName === googleChatSpaceName)
      );
    });
    if (match) {
      account = match;
      scope = parseScope(match.scope);
    }
  }
  if (!account?.userId || scope?.status !== 'linked') return null;
  if (googleChatUserEmail && scope.googleChatUserEmail !== googleChatUserEmail) return null;

  const identity = await requireGoogleChatPearlOsIdentity(account.userId).catch(() => null);
  if (!identity) return null;
  if (
    identity.email !== scope.googleChatUserEmail ||
    identity.googleProviderAccountId !== scope.googleProviderAccountId ||
    identity.tenantId !== scope.tenantId
  ) {
    return null;
  }

  const user = await getUserById(account.userId);
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  const userName = typeof user?.name === 'string' && user.name.trim()
    ? user.name.trim()
    : email || 'Google Chat user';
  if (!email || email !== scope.googleChatUserEmail) return null;

  return {
    googleChatUserName: scope.googleChatUserName,
    googleChatUserEmail: scope.googleChatUserEmail,
    googleChatSpaceName: scope.googleChatSpaceName ?? null,
    googleChatSpaceUri: scope.googleChatSpaceUri ?? null,
    userId: account.userId,
    email,
    userName,
    tenantId: scope.tenantId,
  };
}

export async function getGoogleChatLinkedAccountForUser(userId: string): Promise<GoogleChatLinkedAccountScope | null> {
  const account = await googleChatAccountByUser(userId);
  const scope = parseScope(account?.scope);
  if (!account?.userId || scope?.status !== 'linked') return null;
  return getGoogleChatLinkedAccountScope(scope.googleChatUserName, {
    googleChatUserEmail: scope.googleChatUserEmail,
    googleChatSpaceName: scope.googleChatSpaceName,
  });
}

export async function revokeGoogleChatLink(userId: string): Promise<boolean> {
  const account = await googleChatAccountByUser(userId);
  if (!account?._id) return false;
  await deleteAccount(account._id);
  return true;
}
