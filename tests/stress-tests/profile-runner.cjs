#!/usr/bin/env node
/**
 * profile-runner.cjs
 * Invoked by Clinic's --on-port. Performs auth bootstrap then launches the autocannon harness.
 *
 * Strategy (revised):
 * 1. If PROFILE_EMAIL & PROFILE_PASSWORD provided, attempt credential login for a real user.
 * 2. Else attempt anonymous login (credentials with empty email) – yields an anonymous session.
 * 3. If only anonymous session available, strip write endpoints (POST /api/tenants, /api/users) to avoid 4xx noise.
 * 4. Inject session cookie into AC_HEADERS if user didn't supply one.
 * 5. If authenticated (non-anonymous) and write endpoints present, optionally create a tenant to exercise writes.
 */
const { spawn } = require('child_process');
const http = require('http');

// Scrub invalid NODE_OPTIONS in this process and descendants
delete process.env.NODE_OPTIONS;
delete process.env.NPM_CONFIG_NODE_OPTIONS;
delete process.env.npm_config_node_options;

// Hardcoded defaults (matching autocannon-interface.cjs)
const DEFAULT_TENANT_ID = '7bd902a4-9534-4fc4-b745-f23368590946';
const DEFAULT_AGENT = 'pearlos';
const DEFAULT_CONTENT_TYPE = 'Notes';

const base = process.env.AC_BASE || `http://localhost:${process.env.PORT || 3000}`;

function post(path, body, opts={}) {
  return new Promise((resolve, reject) => {
    const isForm = opts.form === true;
    const data = isForm ? new URLSearchParams(body).toString() : JSON.stringify(body);
    const headers = Object.assign({
      'content-type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
      'content-length': Buffer.byteLength(data)
    }, opts.headers||{});
    const req = http.request(base + path, {
      method: 'POST',
      headers
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, {
      method: 'GET',
      headers: cookie ? { cookie } : undefined
    }, res => {
      let buf='';
      res.on('data', c => buf+=c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  try {
    console.log(`[profile-runner] Base ${base}`);
    // Lazy load .env.local for default admin creds if not already present in env
    if (!process.env.PROFILE_EMAIL && !process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL) {
      try {
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(__dirname, '../..', '.env.local');
        if (fs.existsSync(envPath)) {
          const raw = fs.readFileSync(envPath, 'utf8');
          raw.split(/\r?\n/).forEach(line => {
            if (!line || line.startsWith('#')) return;
            const eq = line.indexOf('=');
            if (eq === -1) return;
            const key = line.slice(0, eq).trim();
            if (!key) return;
            if (process.env[key]) return; // don't override existing
            let val = line.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (key === 'NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL' || key === 'NEXT_PUBLIC_DEFAULT_ADMIN_PASSWORD') {
              process.env[key] = val;
            }
          });
          if (process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL) {
            console.log('[profile-runner] Loaded default admin vars from .env.local');
          }
        }
      } catch (e) {
        console.warn('[profile-runner] Failed to read .env.local:', e.message);
      }
    }
    // Resolve credentials: explicit PROFILE_* overrides, else fall back to default admin env vars
    const email = process.env.PROFILE_EMAIL || process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL;
    const password = process.env.PROFILE_PASSWORD || process.env.NEXT_PUBLIC_DEFAULT_ADMIN_PASSWORD;
    if (email && password) {
      console.log('[profile-runner] Using credential login (source:', process.env.PROFILE_EMAIL ? 'PROFILE_EMAIL' : 'NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL', ')');
    } else {
      console.log('[profile-runner] No credential pair found; will attempt anonymous session.');
    }
    let sessionCookie = '';
    let isAuthenticatedUser = false;

    // Fast path: if user explicitly wants superadmin session, skip auth flows
    if (process.env.FORCE_SUPERADMIN_SESSION === 'true') {
      console.log('[profile-runner] FORCE_SUPERADMIN_SESSION enabled; skipping login and using SUPERADMIN context');
      isAuthenticatedUser = true; // treat as fully authenticated
      // Provide a dummy header to satisfy any header-based retrieval in test mode
      if (!process.env.AC_HEADERS) {
        process.env.AC_HEADERS = JSON.stringify({ 'x-test-user-id': '00000000-0000-0000-0000-000000000000' });
        console.log('[profile-runner] Injected AC_HEADERS with x-test-user-id superadmin');
      }
    }

    if (!isAuthenticatedUser && email && password) {
      console.log('[profile-runner] Attempting credential login for provided PROFILE_EMAIL');
      // 1. Fetch CSRF token
      let csrfToken = '';
      let preCookies = '';
      try {
        const csrfResp = await get('/api/auth/csrf');
        if (csrfResp.status === 200) {
          try { csrfToken = (JSON.parse(csrfResp.body||'{}').csrfToken) || ''; } catch {}
        }
        const setCookiePre = csrfResp.headers['set-cookie'];
        if (setCookiePre) {
          const arr = Array.isArray(setCookiePre)? setCookiePre : [setCookiePre];
          preCookies = arr.map(c => c.split(';')[0]).join('; ');
        }
      } catch (e) {
        console.warn('[profile-runner] CSRF fetch failed', e.message);
      }
      if (!csrfToken) console.warn('[profile-runner] Missing csrfToken (will likely fail)');
      // 2. Post credentials with form encoding & csrf
      const formPayload = { csrfToken, email, password, callbackUrl: base, json: 'true' };
      const loginResp = await post('/api/auth/callback/credentials', formPayload, { form: true, headers: preCookies ? { cookie: preCookies } : undefined });
      const setCookie = loginResp.headers['set-cookie'];
      const cookieList = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
      const cookieNames = cookieList.map(c => c.split('=')[0]);
      console.log('[profile-runner] Login response status', loginResp.status, 'cookies:', cookieNames.join(', ') || '(none)');
      const hasSessionToken = cookieList.some(c => /session-token/.test(c));
      if ([200, 302].includes(loginResp.status) && hasSessionToken) {
        sessionCookie = cookieList.map(c => c.split(';')[0]).join('; ');
        isAuthenticatedUser = true;
        console.log('[profile-runner] Credential login appears successful (session-token present)');
      } else {
        const redirectIndicatesError = loginResp.status === 302 && cookieList.length === 0;
        if (redirectIndicatesError) {
          console.warn('[profile-runner] Likely credentials failure: 302 with no session-token cookie');
        } else if (!hasSessionToken) {
          console.warn('[profile-runner] No session-token cookie found; treating as failed login');
        }
      }
        // Validate session to ensure not anonymous / null
        if (sessionCookie) {
          const sessionResp = await get('/api/auth/session', sessionCookie);
          if (sessionResp.status === 200) {
            try {
              const parsed = JSON.parse(sessionResp.body || '{}');
              const anon = parsed?.user?.is_anonymous;
              const uid = parsed?.user?.id;
              if (!uid || anon) {
                console.warn('[profile-runner] Session indicates anonymous or missing user id; treating as anonymous.');
                isAuthenticatedUser = false;
                // Attempt automatic seeding if we have credentials and user likely doesn't exist yet
                if (email && password) {
                  try {
                    console.log('[profile-runner] Seeding admin user since credential session not established.');
                    const { createUser } = require('@nia/prism/core/actions/user-actions');
                    await createUser({ name: 'Admin', email, password });
                    console.log('[profile-runner] Admin user created. Retrying credential login.');
                    const retryResp = await post('/api/auth/callback/credentials?json=true', { email, password });
                    if ([200,302].includes(retryResp.status)) {
                      const retryCookie = retryResp.headers['set-cookie'];
                      sessionCookie = Array.isArray(retryCookie) ? retryCookie.map(c => c.split(';')[0]).join('; ') : (retryCookie ? retryCookie.split(';')[0] : '');
                      if (sessionCookie) {
                        const verifyResp = await get('/api/auth/session', sessionCookie);
                        if (verifyResp.status === 200) {
                          try {
                            const parsed2 = JSON.parse(verifyResp.body||'{}');
                            const anon2 = parsed2?.user?.is_anonymous;
                            const uid2 = parsed2?.user?.id;
                            if (uid2 && !anon2) {
                              console.log('[profile-runner] Verified authenticated session after seeding user id:', uid2);
                              isAuthenticatedUser = true;
                            } else {
                              console.warn('[profile-runner] Still anonymous after seeding attempt.');
                            }
                          } catch(e) {
                            console.warn('[profile-runner] Failed parsing session after seeding:', e.message);
                          }
                        } else {
                          console.warn('[profile-runner] Session endpoint status after seeding', verifyResp.status);
                        }
                      }
                    } else {
                      console.warn('[profile-runner] Retry credential login failed status', retryResp.status);
                    }
                  } catch (seedErr) {
                    console.warn('[profile-runner] Failed to seed admin user:', seedErr.message);
                  }
                }
              } else {
                console.log('[profile-runner] Verified authenticated session userId=', uid);
              }
            } catch (e) {
              console.warn('[profile-runner] Failed to parse session JSON:', e.message);
              isAuthenticatedUser = false;
            }
          } else {
            console.warn('[profile-runner] /api/auth/session returned', sessionResp.status, 'treating as anonymous');
            isAuthenticatedUser = false;
          }
        }
  }

  if (!isAuthenticatedUser && !sessionCookie) {
      console.log('[profile-runner] Performing anonymous login fallback');
      const anonResp = await post('/api/auth/callback/credentials?json=true', { email: '', password: '' });
      if (![200, 302].includes(anonResp.status)) {
        console.warn('[profile-runner] Anonymous auth failed status', anonResp.status, anonResp.body.slice(0,200));
      }
      const setCookie = anonResp.headers['set-cookie'];
      sessionCookie = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : (setCookie ? setCookie.split(';')[0] : '');
      if (sessionCookie) console.log('[profile-runner] Anonymous session cookie captured');
    }

    if (!process.env.AC_HEADERS && sessionCookie) {
      process.env.AC_HEADERS = JSON.stringify({ cookie: sessionCookie });
      console.log('[profile-runner] Injected AC_HEADERS with session cookie');
    }

    // Dev/test fallback: if still unauthenticated and no cookie captured, inject a superadmin test header
    if (!process.env.AC_HEADERS && (!sessionCookie || !isAuthenticatedUser)) {
      const testSuperId = process.env.SUPERADMIN_USER_ID || '00000000-0000-0000-0000-000000000000';
      process.env.AC_HEADERS = JSON.stringify({ 'x-test-user-id': testSuperId });
      console.log('[profile-runner] Injected AC_HEADERS with x-test-user-id fallback (dev/test)');
    }

    // If not authenticated (anonymous), strip write endpoints to avoid 403 spam
    if (!isAuthenticatedUser && !process.env.AC_ENDPOINTS) {
      process.env.AC_ENDPOINTS = `GET:/api/contentList?type=${DEFAULT_CONTENT_TYPE}&tenantId=${DEFAULT_TENANT_ID}&agent=${DEFAULT_AGENT},GET:/api/dynamicContent?tenantId=${DEFAULT_TENANT_ID}&agent=${DEFAULT_AGENT},GET:/api/assistant?agent=${DEFAULT_AGENT}`;
      console.log('[profile-runner] Adjusted AC_ENDPOINTS (read-only) due to anonymous session');
    }

    const env = { ...process.env, AC_BASE: base };
    const ac = spawn(process.execPath, ['tests/stress-tests/autocannon-interface.cjs'], { stdio: 'inherit', env });
    ac.on('exit', (code) => process.exit(code || 0));
  } catch (e) {
    console.error('[profile-runner] Fatal error', e);
    process.exit(1);
  }
})();
