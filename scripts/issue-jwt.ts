#!/usr/bin/env ts-node
/**
 * Simple JWT issuance utility.
 * Usage:
 *   ts-node scripts/issue-jwt.ts --sub user123 --tenant t1 --roles admin,user --exp 900
 * Defaults: exp 900 seconds (15m)
 * Signing key precedence: AUTH_SIGNING_KEY || NEXTAUTH_SECRET || MESH_SHARED_SECRET
 */
import crypto from 'crypto';
import { JwtPayload } from 'jsonwebtoken';
interface Args { [k:string]: string | boolean | undefined }

function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i=0;i<argv.length;i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.substring(2);
      const next = argv[i+1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

const args = parseArgs();
const sub = (args.sub as string) || (args.user as string);
if (!sub) {
  console.error('Missing --sub <userId>');
  process.exit(1);
}
const tenant = (args.tenant as string) || 'any';
const roles = (args.roles as string | undefined)?.split(',').filter(Boolean);
const now = Math.floor(Date.now()/1000);
const expSec = parseInt((args.exp as string) || '900',10); // default 15m
const payload: JwtPayload = { sub, tenant, iat: now, exp: now + expSec };
if (roles && roles.length) payload.roles = roles;

const header = { alg: 'HS256', typ: 'JWT' };

const key = process.env.AUTH_SIGNING_KEY || process.env.NEXTAUTH_SECRET || process.env.MESH_SHARED_SECRET;
if (!key) {
  console.error('No signing key found in AUTH_SIGNING_KEY|NEXTAUTH_SECRET|MESH_SHARED_SECRET');
  process.exit(2);
}

const h64 = base64url(JSON.stringify(header));
const p64 = base64url(JSON.stringify(payload));
const data = `${h64}.${p64}`;
const sig = base64url(crypto.createHmac('sha256', key).update(data).digest());
const token = `${data}.${sig}`;
console.log(token);
