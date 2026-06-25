import { test, expect, type BrowserContext, type APIResponse } from '@playwright/test';
import { encode } from 'next-auth/jwt';

const BASE_URL = process.env.PEARLOS_URL ?? 'http://localhost:3000';

type TestUser = {
  id: string;
  email: string;
  name: string;
};

const BLAIR: TestUser = {
  id: 'qa-blair-user',
  email: 'blair.qa@pearlos.local',
  name: 'Blair QA',
};

const STEPHANIE: TestUser = {
  id: 'qa-stephanie-user',
  email: 'stephanie.qa@pearlos.local',
  name: 'Stephanie QA',
};

async function sessionCookie(user: TestUser) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for session cookie generation');
  const base = new URL(BASE_URL);
  const token = await encode({
    secret,
    maxAge: 60 * 60,
    token: {
      userId: user.id,
      sessionId: `multi-tenant-${user.id}`,
      is_anonymous: false,
      name: user.name,
      email: user.email,
    },
  });
  return {
    name: '__Secure-interface-auth.session-token',
    value: token,
    domain: base.hostname,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  };
}

async function loginContext(context: BrowserContext, user: TestUser) {
  await context.addCookies([await sessionCookie(user)]);
}

test.describe('multi-tenant API isolation', () => {
  test('unauthenticated callers cannot read user-private surfaces', async ({ request }) => {
    await expectStatus(request.get('/api/notes/files'), 401);
    await expectStatus(request.get('/api/tasks'), 401);
    await expectStatus(request.get('/api/files?path=/workspace'), 401);
  });

  test('profile lookup refuses another userId', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
    await loginContext(context, STEPHANIE);
    const response = await context.request.get(`/api/userProfile?userId=${encodeURIComponent(BLAIR.id)}`);
    expect(response.status()).toBe(403);
    await context.close();
  });

  test('files API is locked to the authenticated user root', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
    await loginContext(context, STEPHANIE);
    await expectStatusOneOf(context.request.get('/api/files?path=/workspace'), [401, 403]);
    await expectStatusOneOf(context.request.get(`/api/files?path=/workspace/user/${encodeURIComponent(BLAIR.id)}`), [401, 403]);
    const ownRoot = await context.request.get(`/api/files?path=/workspace/user/${encodeURIComponent(STEPHANIE.id)}`);
    expect([200, 401, 404]).toContain(ownRoot.status());
    await context.close();
  });

  test('notes file API does not allow direct cross-user path traversal', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
    await loginContext(context, STEPHANIE);
    await expectStatusOneOf(context.request.get('/api/notes/files?id=../Documents/Blair-private'), [400, 401, 404]);
    await context.close();
  });
});

async function expectStatus(responsePromise: Promise<APIResponse>, status: number) {
  const response = await responsePromise;
  expect(response.status()).toBe(status);
}

async function expectStatusOneOf(responsePromise: Promise<APIResponse>, statuses: number[]) {
  const response = await responsePromise;
  expect(statuses).toContain(response.status());
}
