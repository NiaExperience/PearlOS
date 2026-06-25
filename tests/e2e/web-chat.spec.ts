/**
 * Web Chat QA E2E Tests
 * =====================
 * Validates core chat functionality in PearlOS:
 *   1. Streaming response arrives after sending a message
 *   2. Tool calls execute (time check returns real time data)
 *   3. Chat history persists across page reloads
 *
 * Run:
 *   npx playwright test tests/e2e/web-chat.spec.ts \
 *     --config tests/e2e/playwright.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const BASE_URL = process.env.PEARLOS_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const LOGIN_EMAIL = 'pearl@niaxp.com';
const LOGIN_PASSWORD = 'pearlos2026';

// Ensure screenshot directory exists
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await screenshot(page, '01-login-page');

  // Wait for the login form to be ready (it has async loading states)
  const emailInput = page.locator('#email-input');
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });

  await emailInput.fill(LOGIN_EMAIL);
  await page.locator('#password-input').fill(LOGIN_PASSWORD);
  await screenshot(page, '02-login-filled');

  // Submit the form
  await page.locator('form button[type="submit"]').click();

  // Wait for redirect away from /login -- we should land on the main app
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 30_000,
  });
  // Give the SPA a moment to hydrate after redirect
  await page.waitForTimeout(3000);
  await screenshot(page, '03-logged-in');
}

async function openChatAndSend(page: Page, message: string) {
  // The chat textarea has placeholder "Text me" -- wait for it to appear.
  // It may be inside an expandable bar, so we might need to click to expand first.
  const textarea = page.locator('textarea[placeholder="Text me"]');

  // If textarea is not visible, look for a collapsed chat bar to click
  const isVisible = await textarea.isVisible().catch(() => false);
  if (!isVisible) {
    // Try clicking the chat area to expand it
    const chatBar = page.locator('textarea').first();
    if (await chatBar.isVisible().catch(() => false)) {
      await chatBar.click();
    }
    await textarea.waitFor({ state: 'visible', timeout: 10_000 });
  }

  await textarea.fill(message);
  // Press Enter to send (the component sends on Enter without Shift)
  await textarea.press('Enter');
}

test.describe('PearlOS Web Chat QA', () => {
  test.describe.configure({ mode: 'serial' });
  // Login + first navigation can take a while on this SPA
  test.setTimeout(120_000);

  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
    await login(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('chat streams response', async () => {
    // Navigate to the main app page (root or /pearlos)
    const currentUrl = page.url();
    if (!currentUrl.includes(BASE_URL) || currentUrl.includes('/login')) {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    }
    await screenshot(page, '04-before-chat');

    await openChatAndSend(page, 'hello Pearl');
    await screenshot(page, '05-message-sent');

    // Wait for assistant response. OpenClaw takes 5-15s for first token.
    // Look for any new text content after the user's message.
    await page.waitForTimeout(2000); // Let UI settle
    await screenshot(page, '05b-waiting-response');

    // Wait for response text to appear (30s for OpenClaw latency)
    await page.waitForFunction(
      (userMsg: string) => {
        // Find all text nodes in the chat area that aren't the user's message
        const allText = document.body.innerText;
        // Pearl's response should contain content beyond just the user message
        const paragraphs = document.querySelectorAll('p, span, div');
        for (const el of paragraphs) {
          const t = (el.textContent || '').trim();
          if (t.length > 15 && !t.includes(userMsg) && !t.includes('Text me') && !t.includes('pearlos')) {
            // Check if it looks like an assistant response
            if (t.match(/[A-Z][a-z]/) && !t.includes('Desktop') && !t.includes('Soundtrack')) {
              return true;
            }
          }
        }
        return false;
      },
      'hello Pearl',
      { timeout: 30_000 },
    );

    await screenshot(page, '06-response-received');

    // Also try the specific bubble selector
    const assistantBubble = page.locator('.justify-start .chat-bubble-content').last();
    const bubbleVisible = await assistantBubble.isVisible().catch(() => false);

    // Verify we got meaningful content somewhere
    await page.waitForFunction(
      () => {
        const bubbles = document.querySelectorAll('.justify-start .chat-bubble-content');
        if (bubbles.length === 0) return false;
        const last = bubbles[bubbles.length - 1];
        const text = last.textContent || '';
        return text.length > 10;
      },
      { timeout: 15_000 },
    );

    await screenshot(page, '06-response-received');

    const responseText = await assistantBubble.textContent();
    expect(responseText).toBeTruthy();
    expect(responseText!.length).toBeGreaterThan(5);
  });

  test('tool call executes', async () => {
    // Count existing ASSISTANT bubbles before sending
    const assistantCountBefore = await page.locator('.justify-start .chat-bubble-content').count();

    await openChatAndSend(page, 'what time is it right now?');
    await screenshot(page, '07-time-question-sent');

    // Phase 1: Wait for a NEW assistant response bubble beyond the ones already present
    await page.waitForFunction(
      (prevAssistantCount) => {
        const assistantBubbles = document.querySelectorAll('.justify-start .chat-bubble-content');
        if (assistantBubbles.length <= prevAssistantCount) return false;
        // Get the newest assistant bubble
        const last = assistantBubbles[assistantBubbles.length - 1];
        const text = (last.textContent || '').trim();
        return text.length > 10;
      },
      assistantCountBefore,
      { timeout: 45_000 },
    );

    await screenshot(page, '08-time-response');

    // Phase 2: Validate the NEWEST assistant response
    const allAssistantBubbles = page.locator('.justify-start .chat-bubble-content');
    const lastBubble = allAssistantBubbles.last();
    const responseText = await lastBubble.textContent();
    expect(responseText).toBeTruthy();

    const lowerText = (responseText || '').toLowerCase();

    // Check for tool-failure cop-out phrases
    const copOuts = [
      "can't check", "can't run", "tools are",
      "don't have access", "unable to", "cannot determine",
      "don't know the time", "tool call is still abort",
    ];
    const hasCopOut = copOuts.some((phrase) => lowerText.includes(phrase));

    // Check for actual time indicators
    const hasTime =
      /\d{1,2}:\d{2}/.test(responseText || '') ||
      /\b(am|pm)\b/i.test(responseText || '') ||
      /\b(utc|est|pst|cst|mst|gmt|et|pt|ct|mt)\b/i.test(responseText || '') ||
      /\b(o'clock|oclock)\b/i.test(responseText || '');

    // Fail with descriptive message if tools are broken
    if (hasCopOut) {
      expect(hasCopOut, `Pearl's tools are broken in this session. Response: "${responseText?.substring(0, 200)}"`).toBe(false);
    }
    expect(hasTime, `Response did not contain time-like content. Got: "${responseText?.substring(0, 200)}"`).toBe(true);
  });

  test('history persists', async () => {
    await screenshot(page, '09-before-reload');

    // Grab a snippet of message text before reload
    const bubblesBeforeReload = await page.locator('.chat-bubble-content').count();
    expect(bubblesBeforeReload).toBeGreaterThan(0);

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for the page to settle and chat history to load
    await page.waitForTimeout(4000);
    await screenshot(page, '10-after-reload');

    // After reload, the chat bar is collapsed. Click the textarea to expand it.
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 15_000 });
    await textarea.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '10b-chat-expanded');

    // Check that at least one chat bubble is visible after expanding
    const bubbleAfter = page.locator('.chat-bubble-content');

    // Wait for at least one message to reappear
    await expect(bubbleAfter.first()).toBeVisible({ timeout: 15_000 });

    const countAfterReload = await bubbleAfter.count();
    expect(countAfterReload).toBeGreaterThan(0);

    await screenshot(page, '11-history-visible');
  });
});
