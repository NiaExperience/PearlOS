import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import { encode } from 'next-auth/jwt';
import path from 'path';

const BASE_URL = process.env.PEARLOS_URL ?? 'http://localhost:3000';
const LOGIN_EMAIL = process.env.PEARLOS_TEST_EMAIL ?? 'webchat-qa@pearlos.local';
const LOGIN_USER_ID = process.env.PEARLOS_TEST_USER_ID ?? 'webchat-qa-user';
const PRIMARY_USER_EMAIL = (process.env.PEARL_PRIMARY_USER_EMAIL ?? 'blairerickson@gmail.com').toLowerCase();
const RUN_ID = process.env.PEARLOS_QA_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = process.env.PEARLOS_QA_SCREENSHOT_DIR
  ?? path.join(process.cwd(), 'qa', 'screenshots', `webchat-tools-${RUN_ID}`);

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function shot(page: Page, name: string) {
  await showChatTranscript(page);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

async function getSessionCookies() {
  const base = new URL(BASE_URL);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for QA session cookie generation');
  }
  if (LOGIN_EMAIL.toLowerCase() === PRIMARY_USER_EMAIL) {
    throw new Error('Refusing to run QA as the primary user');
  }

  const token = await encode({
    secret,
    maxAge: 30 * 24 * 60 * 60,
    token: {
      userId: LOGIN_USER_ID,
      sessionId: `webchat-qa-${Date.now()}`,
      is_anonymous: false,
      name: 'WebChat QA',
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
  await page.waitForTimeout(2500);
}

async function sendChat(page: Page, prompt: string) {
  const textarea = page.locator('textarea[placeholder="Text me"], textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 20_000 });
  await textarea.evaluate((el, value) => {
    const input = el as HTMLTextAreaElement;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, prompt);
  await page.keyboard.press('Enter');
}

async function showChatTranscript(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pearl:new-task')));
  const minimizeButton = page.getByRole('button', { name: 'Minimize chat' });
  const expanded = await minimizeButton.waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!expanded) {
    const textarea = page.locator('textarea[placeholder="Text me"], textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.click().catch(() => {});
    }
  }
  await page.waitForTimeout(3500);
}

async function waitForBodyText(page: Page, pattern: RegExp) {
  await expect(page.locator('body')).toContainText(pattern, { timeout: 90_000 });
}

async function closeVisibleWindows(page: Page) {
  for (let i = 0; i < 8; i++) {
    const closeButton = page.getByRole('button', { name: /Close .*|Close window/i }).first();
    if (!(await closeButton.isVisible().catch(() => false))) return;
    await closeButton.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

test.describe.serial('Pearl web chat tool proof', () => {
  test.setTimeout(12 * 60_000);

  test('five chat-driven tool calls render in the UI', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await login(page, context);
    await closeVisibleWindows(page);
    await shot(page, '00-logged-in');

    await sendChat(page, 'Call bot_get_weather for Boston and show the weather view.');
    await waitForBodyText(page, /Weather: Boston|Live weather|Boston/i);
    await shot(page, '01-weather-boston');

    await sendChat(page, "Call bot_open_note for the specific note titled Pearl's Journal.");
    await waitForBodyText(page, /Pearl's Journal/i);
    await shot(page, '02-pearls-journal-note');

    const noteTitle = `QA Web Chat Tool Proof ${RUN_ID}`;
    await sendChat(page, `Call bot_create_note to create a note titled "${noteTitle}" with the content "Web chat create-note tool proof for ${RUN_ID}".`);
    await waitForBodyText(page, new RegExp(noteTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    await shot(page, '03-create-note');

    await sendChat(page, 'Call bot_open_youtube and search for lofi coding music.');
    await waitForBodyText(page, /YouTube/i);
    await shot(page, '04-youtube-open');

    await sendChat(page, 'Call bot_open_terminal to open the terminal app.');
    await waitForBodyText(page, /Terminal/i);
    await shot(page, '05-terminal-open');

    await context.close();
  });
});
