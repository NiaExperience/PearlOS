import crypto from 'crypto';

import { Request, Response, NextFunction } from 'express';

import { AuthContextUser } from '../types/express';

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function verifyHs256(token: string, secret: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h64, p64, sig] = parts;
    const data = `${h64}.${p64}`;
    const expected = base64url(crypto.createHmac('sha256', secret).update(data).digest());
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(p64, 'base64').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const meshSecret = process.env.MESH_SHARED_SECRET;
  const botControlSecret = process.env.BOT_CONTROL_SHARED_SECRET;
  const authSigningKey = process.env.AUTH_SIGNING_KEY || process.env.NEXTAUTH_SECRET || meshSecret || '';

  // Service secret check
  let serviceTrusted = false;
  if (meshSecret) {
    const provided = req.headers['x-mesh-secret'];
    serviceTrusted = !!provided && provided === meshSecret;
  }

  // Bot control secret check (for bot service operations)
  let botControlTrusted = false;
  if (botControlSecret) {
    const provided = req.headers['x-bot-control-secret'];
    botControlTrusted = !!provided && provided === botControlSecret;
  }

  // User token check
  let user: AuthContextUser | undefined;
  const authz = req.headers.authorization;
  if (authz && authz.startsWith('Bearer ')) {
    const token = authz.substring('Bearer '.length).trim();
    const payload = verifyHs256(token, authSigningKey);
    if (payload && payload.sub) {
      user = {
        id: payload.sub,
        tenant: payload.tenant || 'any',
        roles: Array.isArray(payload.roles) ? payload.roles : undefined,
      };
    }
  }

  req.auth = { serviceTrusted, botControlTrusted, user };
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.user) return res.status(401).json({ success: false, error: { message: 'Unauthorized (user token required)' } });
  next();
}

export function requireService(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.serviceTrusted) return res.status(401).json({ success: false, error: { message: 'Unauthorized (service secret required)' } });
  next();
}

export function requireBotControl(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.botControlTrusted) return res.status(401).json({ success: false, error: { message: 'Unauthorized (bot control secret required)' } });
  next();
}

export function requireServiceOrBotControl(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.serviceTrusted && !req.auth?.botControlTrusted) {
    return res.status(401).json({ success: false, error: { message: 'Unauthorized (service or bot control secret required)' } });
  }
  next();
}
