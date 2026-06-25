import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { encode } from 'next-auth/jwt';
import { AssistantActions } from '@nia/prism/core/actions';
import { getUserByEmail, getUserById, createUser } from '@nia/prism/core/actions/user-actions';
import { getUserTenantRoles, assignUserToTenant } from '@nia/prism/core/actions/tenant-actions';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

const BASE_URL = process.env.PEARLOS_URL ?? 'https://134-209-76-227.sslip.io/pearlos';
const LOGIN_EMAIL = process.env.PEARLOS_TEST_EMAIL ?? 'webchat-qa@pearlos.local';
const RUN_ID = process.env.PEARLOS_QA_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = process.env.PEARLOS_QA_SCREENSHOT_DIR
  ?? path.join('/workspace/user/Documents/pearl-vision-qa', RUN_ID);

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function uuidFromStableLabel(label: string): string {
  const hash = crypto.createHash('sha256').update(label).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

function qaUserId(): string {
  const raw = (process.env.PEARLOS_TEST_USER_ID ?? '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  return uuidFromStableLabel(raw || LOGIN_EMAIL);
}

const LOGIN_USER_ID = qaUserId();

async function ensureQaIdentity() {
  const assistant = await AssistantActions.getAssistantBySubDomain('pearlos');
  if (!assistant?.tenantId) throw new Error('pearlos assistant tenant is required for Pearl Vision QA');

  const userById = await getUserById(LOGIN_USER_ID);
  if (!userById) {
    const userByEmail = await getUserByEmail(LOGIN_EMAIL).catch(() => null);
    if (userByEmail?._id && userByEmail._id !== LOGIN_USER_ID) {
      throw new Error(`QA email ${LOGIN_EMAIL} already belongs to a different user id`);
    }
    await createUser({
      _id: LOGIN_USER_ID,
      name: 'Pearl Vision QA',
      email: LOGIN_EMAIL,
      emailVerified: new Date().toISOString(),
      image: null,
      metadata: { source: 'pearl-vision-qa' },
    });
  }

  const roles = await getUserTenantRoles(LOGIN_USER_ID).catch(() => []);
  if (!roles.some((role) => role.tenantId === assistant.tenantId)) {
    await assignUserToTenant(LOGIN_USER_ID, assistant.tenantId, TenantRole.MEMBER);
  }
}

async function getSessionCookies() {
  const base = new URL(BASE_URL);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for QA session cookie generation');
  }

  const token = await encode({
    secret,
    maxAge: 30 * 24 * 60 * 60,
    token: {
      userId: LOGIN_USER_ID,
      sessionId: `pearl-vision-qa-${Date.now()}`,
      is_anonymous: false,
      name: 'Pearl Vision QA',
      email: LOGIN_EMAIL,
    },
  });

  return [{
    name: '__Secure-interface-auth.session-token',
    value: token,
    domain: base.hostname,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  }];
}

async function login(page: Page, context: BrowserContext) {
  await context.addCookies(await getSessionCookies());
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).not.toContainText(/continue with google/i, { timeout: 30_000 });
  await page.waitForLoadState('domcontentloaded');
}

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});

test.describe('Pearl Vision', () => {
  test.setTimeout(180_000);

  test('Pearl is visible in a vision voice call', async ({ browser }) => {
    await ensureQaIdentity();

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
      permissions: ['camera', 'microphone'],
    });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const botJoinResponses: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/bot/join')) {
        botJoinResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    const screenshotPath = path.join(SCREENSHOT_DIR, 'pearl-vision-working.png');

    try {
      await login(page, context);
      await expect(page.locator('body')).toContainText(/Pearl/i, { timeout: 30_000 });

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('nia.window.open-request', {
          detail: {
            viewType: 'dailyCall',
            viewState: { dailyMode: 'vision' },
            source: 'playwright:pearl-vision',
          },
        }));
      });

      await expect(page.locator('[data-role="daily-call-root"]')).toBeVisible({ timeout: 30_000 });
      const pearlBotTile = page.locator('.tile-container.pearl-bot').first();
      await expect(pearlBotTile).toBeVisible({ timeout: 120_000 });
      await expect(
        pearlBotTile.locator('.username-label.pearl-bot-label', { hasText: 'Pearl' }),
      ).toBeVisible({ timeout: 10_000 });
      await page.waitForFunction(() => {
        const audio = document.querySelector('audio.daily-call-bot-audio') as HTMLAudioElement | null;
        const stream = audio?.srcObject instanceof MediaStream ? audio.srcObject : null;
        return Boolean(audio && stream?.getAudioTracks().length && !audio.paused);
      }, null, { timeout: 45_000 });

      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(JSON.stringify({
        screenshotPath,
        botJoinResponses,
        consoleErrors,
      }, null, 2));
    } catch (error) {
      const failurePath = path.join(SCREENSHOT_DIR, 'pearl-vision-failure.png');
      await page.screenshot({ path: failurePath, fullPage: true }).catch(() => {});
      console.log(JSON.stringify({
        failurePath,
        botJoinResponses,
        consoleErrors,
      }, null, 2));
      throw error;
    } finally {
      await context.close();
    }
  });
});
