// Lazy require nodemailer only in server (node) contexts to avoid bundling issues / child_process resolution in edge/client.
// We keep a typed reference while deferring the actual require until used.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let _nodemailer: typeof import('nodemailer') | null = null;
function nm() {
  if (!_nodemailer) {
    // Only attempt to load in a Node.js runtime
    if (typeof process !== 'undefined' && process.versions?.node) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('nodemailer');
      // Support both CommonJS and potential mocked default export shapes
      _nodemailer = mod.default ? mod.default : mod;
    } else {
      throw new Error('nodemailer unavailable in this runtime');
    }
  }
  return _nodemailer!;
}
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import crypto from 'crypto';
import { ResetPasswordTokenActions } from '../actions';
import { incrementResetPasswordTokenAttempts } from '../actions/reset-password-token-actions';
import { platformDefinitionsIndex } from '../platform-definitions';
import { Prism } from '../../prism';
import { getLogger } from '../logger';

const log = getLogger('prism:email');

// Simple transport using environment or ethereal dev fallback
// Supported env vars: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

let transporterPromise: Promise<import('nodemailer').Transporter> | null = null;
let sesClient: SESClient | null = null;

function getSesClient(): SESClient | null {
  if (sesClient) return sesClient;
  // Region resolution order: explicit SES override -> AWS_REGION -> AWS_DEFAULT_REGION (dev convenience)
  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) return null;
  const forceSes = process.env.EMAIL_FORCE_SES === 'true';
  // If SMTP host present and not forcing SES, honor explicit SMTP override
  if (process.env.SMTP_HOST && !forceSes) return null;
  try {
    sesClient = new SESClient({ region });
    if (process.env.NODE_ENV !== 'production') {
      log.info('Using SES transport', {
        env: process.env.NODE_ENV || 'development',
        region,
        forceSes,
        hasSmtpHost: !!process.env.SMTP_HOST,
      });
      if (process.env.SMTP_HOST && forceSes) {
        log.info('EMAIL_FORCE_SES overriding SMTP configuration');
      }
    }
    return sesClient;
  } catch (e) {
    log.error('Failed to init SES client', { error: e });
    if (process.env.NODE_ENV === 'production') {
      throw e;
    }
    return null;
  }
}

async function createTransport() {
  if (process.env.SMTP_HOST) {
    return nm().createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER && process.env.SMTP_PASS ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  if (process.env.NODE_ENV === 'production') {
    log.error('No SES region or SMTP configuration present in production environment');
    throw new Error('[email] No SES region or SMTP configuration present in production environment');
  }
  // Dev/test fallback to ethereal
  const nodemailer = nm();
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}

async function getTransporter() {
  if (!transporterPromise) transporterPromise = createTransport();
  return transporterPromise;
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<{ messageId: string; previewUrl?: string }> {
  const from = process.env.EMAIL_FROM || 'no-reply@example.com';
  const isTest = process.env.NODE_ENV === 'test';
  // In tests, ignore REQUIRE/FORCE unless explicitly allowed via EMAIL_ALLOW_SES_IN_TEST
  const requireSes = process.env.EMAIL_REQUIRE_SES === 'true' && !isTest;
  const forceSes = process.env.EMAIL_FORCE_SES === 'true';
  const skipSesInTest = isTest && !forceSes && !requireSes; // default: skip SES in test to avoid external calls / expired creds
  const ses = skipSesInTest ? null : getSesClient();
  if (ses) {
    try {
      const command = new SendEmailCommand({
        Destination: { ToAddresses: [to] },
        Source: from,
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: (text || html.replace(/<[^>]+>/g, ' ')), Charset: 'UTF-8' },
          },
        },
      });
      const resp = await ses.send(command);
      log.info('Email sent via SES', { to, messageId: resp.MessageId || 'unknown', response: resp });
      return { messageId: resp.MessageId || 'unknown', previewUrl: undefined };
    } catch (e: any) {
      log.error('SES send failed', { error: e, code: e?.code || e?.name });
      if (process.env.NODE_ENV === 'production' || (requireSes && !skipSesInTest) || (forceSes && !skipSesInTest)) {
        throw e;
      }
      // non-production fallback to nodemailer
    }
  } else if (!skipSesInTest && requireSes) {
    // SES client unavailable but explicitly required
    log.error('SES required but not configured');
    throw new Error('[email] SES required but not configured (set AWS_REGION or AWS_SES_REGION)');
  }
  const transporter = await getTransporter();
  const info = await transporter.sendMail({ from, to, subject, html, text: text || html.replace(/<[^>]+>/g, '') });
  const previewUrl = nm().getTestMessageUrl(info) || undefined;
  if (previewUrl) {
    log.warn('Using development fallback transport (Ethereal)', {
      hint: 'Set AWS_REGION and EMAIL_FROM (verified) to enable SES.',
      to,
      messageId: info.messageId,
      previewUrl,
    });
  }
  return { messageId: info.messageId, previewUrl };
}

// Shared helpers for invitation emails

/** Resolve the Interface base URL using env and sensible localhost fallbacks */
export function resolveInterfaceBaseUrl(reqUrl?: string): string {
  let baseUrl = process.env.NEXT_PUBLIC_INTERFACE_BASE_URL || process.env.INTERFACE_BASE_URL || process.env.APP_BASE_URL_INTERFACE || process.env.APP_BASE_URL;
  if (!baseUrl) {
    try {
      if (reqUrl) {
        const origin = new URL(reqUrl).origin;
        const inferred = origin.replace('://localhost:4000', '://localhost:3000');
        baseUrl = inferred !== origin ? inferred : 'http://localhost:3000';
      } else {
        baseUrl = 'http://localhost:3000';
      }
    } catch {
      baseUrl = 'http://localhost:3000';
    }
  }
  return baseUrl.replace(/\/$/, '');
}

/** Build the accept-invite URL with token and optional assistant subdomain */
export function buildInviteLink(baseUrl: string, token: string, assistantSubDomain?: string): string {
  const params = new URLSearchParams({ token });
  if (assistantSubDomain) params.set('assistant', assistantSubDomain);
  return `${baseUrl.replace(/\/$/, '')}/accept-invite?${params.toString()}`;
}

/** Compose subject and HTML body for an activation invite, using assistant name when available */
export function composeInviteEmail(inviteLink: string, assistantName?: string): { subject: string; html: string; text?: string } {
  const display = assistantName?.trim() || 'Nia';
  const subject = `You are invited to ${display}`;
  const html = `<p>You have been invited to ${display}.</p><p><a href="${inviteLink}">Accept Invitation</a> (valid 72 hours)</p>`;
  const text = `You have been invited to ${display}. Open this link to accept (valid 72 hours): ${inviteLink}`;
  return { subject, html, text };
}

/** Convenience: send activation invite email (accept-invite) and return delivery info */
export async function sendActivationInviteEmail(opts: { to: string; token: string; reqUrl?: string; assistantSubDomain?: string; assistantName?: string }): Promise<{ messageId: string; previewUrl?: string; inviteLink: string }> {
  const baseUrl = resolveInterfaceBaseUrl(opts.reqUrl);
  const inviteLink = buildInviteLink(baseUrl, opts.token, opts.assistantSubDomain);
  const { subject, html, text } = composeInviteEmail(inviteLink, opts.assistantName);
  const { messageId, previewUrl } = await sendEmail({ to: opts.to, subject, html, text });
  return { messageId, previewUrl, inviteLink };
}

// Hardened in-memory reset token store (still ephemeral). We never store raw token; we store a hash.
// Token format returned to user: base64url(iv.ciphertext.signature)
interface ResetTokenRecord { userId: string; email: string; expiresAt: number; tokenHash: string; purpose: 'password_reset' | 'invite_activation'; }
const resetTokenMap = new Map<string, ResetTokenRecord>(); // key = tokenHash

function getTokenKey(): Buffer {
  const keyB64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyB64) throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  const raw = Buffer.from(keyB64, 'base64');
  // Normalize to 32 bytes (AES-256)
  if (raw.length === 32) return raw;
  return crypto.createHash('sha256').update(raw).digest();
}

function b64url(buf: Buffer) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Exposed only for test utilities to pre-hash synthetic tokens (not used in normal issuance flow)
export async function hashTokenForPersistence(token: string): Promise<string> {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Test-only metadata map (raw token -> { tokenHash, recordId }) enabling deeper assertions (attempt increments, consumed state)
// Never populated outside NODE_ENV==='test'.
export const __testTokenMeta: Map<string, { tokenHash: string; recordId?: string; purpose: string; attempts?: number }> = new Map();

/**
 * Issue a secure user token (password reset or invite activation).
 * Backwards-compatible signature: issueResetToken(userId,email) defaults to password reset.
 * New optional params allow specifying purpose & ttlMs.
 */
export async function issueResetToken(userId: string, email: string, opts?: { purpose?: 'password_reset' | 'invite_activation'; ttlMs?: number }): Promise<string> {
  const key = getTokenKey();
  const iv = crypto.randomBytes(12);
  const purpose = opts?.purpose || 'password_reset';
  const payload = JSON.stringify({ userId, email, purpose, iat: Date.now() });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const tokenRaw = Buffer.concat([iv, authTag, ciphertext]);
  const signature = crypto.createHmac('sha256', key).update(tokenRaw).digest();
  const token = b64url(Buffer.concat([tokenRaw, signature]));
  // Hash for storage (constant-time compare potential)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const ttlMs = opts?.ttlMs && opts.ttlMs > 0 ? opts.ttlMs : (purpose === 'invite_activation' ? 1000 * 60 * 60 * 72 : 1000 * 60 * 30); // Invite default 72h, reset 30m
  const expiresAt = Date.now() + ttlMs;
  // Persistence is now ON by default; only disabled when explicitly set to 'disabled'
  const usePersistence = process.env.RESET_TOKEN_PERSISTENCE !== 'disabled';
  if (usePersistence) {
    let persisted = false;
    try {
      const created = await ResetPasswordTokenActions.createResetPasswordToken({
        tokenHash,
        userId,
        email,
        expiresAt: new Date(expiresAt).toISOString(),
        purpose,
        attempts: 0,
        issuedAt: new Date().toISOString(),
      });
      if (process.env.NODE_ENV === 'test') {
        __testTokenMeta.set(token, { tokenHash, recordId: created._id, purpose });
      }
      persisted = true;
    } catch (e: any) {
      // Attempt self-healing: create missing definition then retry once
      try {
        const def = (platformDefinitionsIndex as any).ResetPasswordToken;
        if (def) {
          const prism = await Prism.getInstance();
          await prism.createDefinition(def as any);
          const created = await ResetPasswordTokenActions.createResetPasswordToken({
            tokenHash,
            userId,
            email,
            expiresAt: new Date(expiresAt).toISOString(),
            purpose,
            attempts: 0,
            issuedAt: new Date().toISOString(),
          });
          if (process.env.NODE_ENV === 'test') {
            __testTokenMeta.set(token, { tokenHash, recordId: created._id, purpose });
          }
          persisted = true;
        }
      } catch (inner) {
        log.error('[issueResetToken] definition self-heal failed', { error: inner });
      }
      if (!persisted) {
        log.error('[issueResetToken] persistence create failed, falling back to memory', { error: e });
        resetTokenMap.set(tokenHash, { userId, email, expiresAt, tokenHash, purpose });
        if (process.env.NODE_ENV === 'test') {
          __testTokenMeta.set(token, { tokenHash, purpose });
        }
      }
    }
  } else {
    resetTokenMap.set(tokenHash, { userId, email, expiresAt, tokenHash, purpose });
    if (process.env.NODE_ENV === 'test') {
      __testTokenMeta.set(token, { tokenHash, purpose });
    }
  }
  return token;
}

/** Convenience wrapper for issuing invite activation tokens */
export async function issueInviteToken(userId: string, email: string, ttlHours = 72) {
  return issueResetToken(userId, email, { purpose: 'invite_activation', ttlMs: ttlHours * 60 * 60 * 1000 });
}

/**
 * Consume a user token. Optionally enforce expected purpose(s) when provided.
 */
export async function consumeResetToken(token: string, expectedPurpose?: ('password_reset' | 'invite_activation')[]): Promise<{ userId: string; email: string; purpose: 'password_reset' | 'invite_activation' } | null> {
  try {
    const key = getTokenKey();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // Persistence is now ON by default; only disabled when explicitly set to 'disabled'
    const usePersistence = process.env.RESET_TOKEN_PERSISTENCE !== 'disabled';
    if (usePersistence) {
      const rec = await ResetPasswordTokenActions.getResetPasswordTokenByHash(tokenHash);
      if (!rec) return null;
      const now = Date.now();
      if (new Date(rec.expiresAt).getTime() < now) {
        // Expired: increment attempts then delete (for signal)
        try { await incrementResetPasswordTokenAttempts(rec._id as string); } catch { }
        await ResetPasswordTokenActions.deleteResetPasswordToken(rec._id as string);
        return null;
      }
      if (rec.consumedAt) {
        try {
          const updated = await incrementResetPasswordTokenAttempts(rec._id as string);
          if (process.env.NODE_ENV === 'test') {
            const meta = __testTokenMeta.get(token);
            if (meta) __testTokenMeta.set(token, { ...meta, attempts: updated?.attempts });
          }
        } catch { }
        return null; // already used
      }
      if (expectedPurpose && !expectedPurpose.includes(rec.purpose)) {
        try {
          const updated = await incrementResetPasswordTokenAttempts(rec._id as string);
          if (process.env.NODE_ENV === 'test') {
            const meta = __testTokenMeta.get(token);
            if (meta) __testTokenMeta.set(token, { ...meta, attempts: updated?.attempts });
          }
        } catch { }
        return null;
      }
      await ResetPasswordTokenActions.consumeResetPasswordToken(rec._id as string);
      return { userId: rec.userId, email: rec.email || '', purpose: rec.purpose };
    } else {
      const rec = resetTokenMap.get(tokenHash);
      if (!rec) return null;
      if (Date.now() > rec.expiresAt) {
        resetTokenMap.delete(tokenHash);
        return null;
      }
      if (expectedPurpose && !expectedPurpose.includes(rec.purpose)) return null;
      resetTokenMap.delete(tokenHash); // one-time use
      return { userId: rec.userId, email: rec.email, purpose: rec.purpose };
    }
  } catch {
    return null;
  }
}

/**
 * Verify a user token without consuming it. Returns minimal info when valid and unexpired.
 */
export async function verifyResetToken(token: string, expectedPurpose?: ('password_reset' | 'invite_activation')[]): Promise<{ userId: string; email: string; purpose: 'password_reset' | 'invite_activation'; consumed?: boolean; expiresAt?: string } | null> {
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const usePersistence = process.env.RESET_TOKEN_PERSISTENCE !== 'disabled';
    if (usePersistence) {
      const rec = await ResetPasswordTokenActions.getResetPasswordTokenByHash(tokenHash);
      if (!rec) return null;
      const now = Date.now();
      if (new Date(rec.expiresAt).getTime() < now) return null;
      if (expectedPurpose && !expectedPurpose.includes(rec.purpose)) return null;
      return { userId: rec.userId, email: rec.email || '', purpose: rec.purpose, consumed: !!rec.consumedAt, expiresAt: rec.expiresAt as any };
    } else {
      const rec = resetTokenMap.get(tokenHash);
      if (!rec) return null;
      if (Date.now() > rec.expiresAt) return null;
      if (expectedPurpose && !expectedPurpose.includes(rec.purpose)) return null;
      return { userId: rec.userId, email: rec.email, purpose: rec.purpose };
    }
  } catch {
    return null;
  }
}

export function pruneExpiredResetTokens() {
  const now = Date.now();
  for (const [hash, rec] of resetTokenMap) {
    if (now > rec.expiresAt) resetTokenMap.delete(hash);
  }
}
