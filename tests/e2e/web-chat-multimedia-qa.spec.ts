import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { encode } from 'next-auth/jwt';

const BASE_URL = process.env.PEARLOS_URL ?? 'https://134-209-76-227.sslip.io';
const LOGIN_EMAIL = process.env.PEARLOS_TEST_EMAIL ?? 'webchat-qa@pearlos.local';
const LOGIN_USER_ID = process.env.PEARLOS_TEST_USER_ID ?? 'webchat-qa-user';
const PRIMARY_USER_EMAIL = (process.env.PEARL_PRIMARY_USER_EMAIL ?? 'blairerickson@gmail.com').toLowerCase();
const RUN_ID = process.env.PEARLOS_QA_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = process.env.PEARLOS_QA_OUT_DIR ?? path.join('/workspace/user/Documents/webchat-qa', `multimedia-${RUN_ID}`);
const SCREENSHOT_DIR = path.join(OUT_DIR, 'screenshots');
const RESULT_PATH = path.join(OUT_DIR, 'raw-results.json');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

type ScenarioResult = {
  name: string;
  prompt: string;
  screenshotPath: string;
  sha256: string;
  bodyText: string;
  chatText: string;
  visibleSignals: string[];
  consoleErrors: string[];
};

const consoleErrors: string[] = [];

async function getSessionCookies() {
  const base = new URL(BASE_URL);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required');
  if (LOGIN_EMAIL.toLowerCase() === PRIMARY_USER_EMAIL) {
    throw new Error('Refusing to run QA as the primary user');
  }
  const token = await encode({
    secret,
    maxAge: 30 * 24 * 60 * 60,
    token: {
      userId: LOGIN_USER_ID,
      sessionId: `webchat-multimedia-qa-${Date.now()}`,
      is_anonymous: false,
      name: 'WebChat Multimedia QA',
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

async function showChat(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pearl:new-task')));
  const textarea = page.locator('textarea[placeholder="Text me"], textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 30_000 });
  const minimized = await page.getByRole('button', { name: /Minimize chat/i }).isVisible().catch(() => false);
  if (!minimized) await textarea.click().catch(() => {});
  await page.waitForTimeout(800);
}

async function archiveChat(page: Page) {
  await page.evaluate(async () => {
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key === 'pearl-chat-history-v1' || key.startsWith('pearl-chat-history-v1:') || key === 'pearl-chat-archives-v1') {
          window.localStorage.removeItem(key);
        }
      }
    } catch {}
    await fetch('/api/chat/archive', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
}

async function sendChat(page: Page, prompt: string) {
  await showChat(page);
  const textarea = page.locator('textarea[placeholder="Text me"], textarea').first();
  await textarea.evaluate((el, value) => {
    const input = el as HTMLTextAreaElement;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, prompt);
  await page.keyboard.press('Enter');
}

async function waitForSettledResponse(page: Page, pattern: RegExp) {
  await expect(page.locator('body')).toContainText(pattern, { timeout: 150_000 });
  await page.waitForTimeout(4500);
}

async function closeVisibleWindows(page: Page) {
  for (let i = 0; i < 8; i++) {
    const closeButton = page.getByRole('button', { name: /Close .*|Close window/i }).first();
    if (!(await closeButton.isVisible().catch(() => false))) return;
    await closeButton.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function collectSignals(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const signals: string[] = [];
    const selectors = ['canvas', 'iframe', 'video', 'audio', 'svg', 'img', '[role="dialog"]', '[data-window-id]', '[class*="window"]'];
    for (const selector of selectors) {
      const count = document.querySelectorAll(selector).length;
      if (count) signals.push(`${selector}: ${count}`);
    }
    for (const text of ['Weather', 'Seattle', 'YouTube', 'Notes', 'sprite', 'hosting', 'PDF', 'oil', 'streaming']) {
      if (document.body.innerText.toLowerCase().includes(text.toLowerCase())) signals.push(`text:${text}`);
    }
    return signals;
  });
}

async function screenshotResult(page: Page, name: string, prompt: string): Promise<ScenarioResult> {
  await showChat(page);
  const screenshotPath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const buf = fs.readFileSync(screenshotPath);
  const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  return {
    name,
    prompt,
    screenshotPath,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    bodyText: bodyText.slice(-12000),
    chatText: bodyText.slice(-6000),
    visibleSignals: await collectSignals(page),
    consoleErrors: [...consoleErrors],
  };
}

function simplePdfBuffer(): Buffer {
  const text = 'PearlOS QA PDF. Topic: Solar inventory. Findings: six silver necklaces, three sapphire rings, and one repair ticket. Recommendation: restock ring boxes before Friday.';
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
xref
0 6
0000000000 65535 f
trailer << /Root 1 0 R /Size 6 >>
startxref
0
%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

async function uploadPdf(page: Page): Promise<string> {
  const pdfBase64 = simplePdfBuffer().toString('base64');
  const response = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], 'pearlos-qa-solar-inventory.pdf', { type: 'application/pdf' }));
    const res = await fetch('/api/chat/upload', { method: 'POST', body: form });
    return res.json();
  }, pdfBase64);
  if (!response?.attachmentContext) throw new Error(`PDF upload failed: ${JSON.stringify(response)}`);
  return response.attachmentContext;
}

test.describe.serial('Web chat multimedia QA one-shot', () => {
  test.setTimeout(24 * 60_000);

  test('required scenarios render meaningful web chat output', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const results: ScenarioResult[] = [];
    await login(page, context);
    await archiveChat(page);
    await closeVisibleWindows(page);

    await sendChat(page, "what's weather in Seattle");
    await waitForSettledResponse(page, /Weather for Seattle:/i);
    results.push(await screenshotResult(page, '01-weather-seattle', "what's weather in Seattle"));
    await closeVisibleWindows(page);

    await sendChat(page, 'Which company dominates streaming?');
    await waitForSettledResponse(page, /Streaming Market Share|Netflix is the strongest answer/i);
    results.push(await screenshotResult(page, '02-streaming-company', 'Which company dominates streaming?'));
    await closeVisibleWindows(page);

    await sendChat(page, "what's the scariest movie?");
    await waitForSettledResponse(page, /Scariest Movie|My pick is Hereditary/i);
    results.push(await screenshotResult(page, '03-scariest-movie', "what's the scariest movie?"));
    await closeVisibleWindows(page);

    await sendChat(page, "let's create a website that shows my jewelry");
    await waitForSettledResponse(page, /host the first version from your PearlOS user folder/i);
    results.push(await screenshotResult(page, '04-jewelry-website', "let's create a website that shows my jewelry"));
    await closeVisibleWindows(page);

    const attachmentContext = await uploadPdf(page);
    const pdfPrompt = `analyze this PDF\n\n${attachmentContext}`;
    await sendChat(page, pdfPrompt);
    await waitForSettledResponse(page, /six silver necklaces|sapphire rings|ring boxes before Friday/i);
    results.push(await screenshotResult(page, '05-analyze-pdf', 'analyze this PDF'));
    await closeVisibleWindows(page);

    await sendChat(page, 'I need to create a report on Iran conflict impact on oil prices');
    await waitForSettledResponse(page, /I created a detailed Notes report|Iran Conflict Impact on Oil Prices/i);
    results.push(await screenshotResult(page, '06-iran-oil-report', 'I need to create a report on Iran conflict impact on oil prices'));
    await closeVisibleWindows(page);

    await sendChat(page, 'create a tiny pixel sprite of a moonlit silver fox mage');
    await waitForSettledResponse(page, /Sprite Draft|substantive sprite draft|moonlit silver fox mage/i);
    results.push(await screenshotResult(page, '07-sprite-regression', 'create a tiny pixel sprite of a moonlit silver fox mage'));

    fs.writeFileSync(RESULT_PATH, JSON.stringify({
      baseUrl: BASE_URL,
      runId: RUN_ID,
      resultPath: RESULT_PATH,
      screenshotDir: SCREENSHOT_DIR,
      results,
    }, null, 2));
    await context.close();
  });
});
