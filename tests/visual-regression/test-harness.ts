/**
 * PearlOS Visual Regression Test Harness
 *
 * Provides helpers for Playwright tests that invoke PearlOS tools via the
 * gateway REST API, take screenshots, and capture console output.
 */

import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4444';
const SCREENSHOTS_DIR = path.resolve(__dirname, 'screenshots');

// Ensure screenshots directory exists
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

export interface ToolResult {
  screenshot: Buffer;
  consoleLogs: string[];
  consoleErrors: string[];
  timestamp: Date;
  toolName: string;
  httpStatus: number;
  responseBody: any;
  screenshotPath: string;
}

export interface TestReport {
  testName: string;
  results: ToolResult[];
  passed: boolean;
  error?: string;
  durationMs: number;
}

const _reports: TestReport[] = [];

/** Collect console messages from page */
export function setupConsoleCapture(page: Page) {
  const logs: string[] = [];
  const errors: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    if (msg.type() === 'error') errors.push(text);
  });
  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });
  return { logs, errors };
}

/** Navigate to PearlOS and wait for the Stage component */
export async function loadPearlOS(page: Page) {
  await page.goto('/pearlos', { waitUntil: 'networkidle', timeout: 30_000 });
  // Wait for the Stage/app root to appear
  await page.waitForSelector('#root, [data-testid="stage"], .stage, main', {
    timeout: 15_000,
  }).catch(() => {
    // If none of the specific selectors match, just wait for body content
    return page.waitForSelector('body', { timeout: 5_000 });
  });
  // Extra settle time for React hydration
  await page.waitForTimeout(2000);
}

/** Invoke a tool via the gateway API and take a screenshot */
export async function invokeToolAndScreenshot(
  page: Page,
  toolName: string,
  params: Record<string, any> = {},
  opts: { waitMs?: number; label?: string; consoleLogs?: string[]; consoleErrors?: string[] } = {},
): Promise<ToolResult> {
  const waitMs = opts.waitMs ?? 2000;
  const label = opts.label ?? toolName;
  const consoleLogs = opts.consoleLogs ?? [];
  const consoleErrors = opts.consoleErrors ?? [];

  // Invoke via REST API
  let httpStatus = 0;
  let responseBody: any = {};
  try {
    const res = await fetch(`${GATEWAY_URL}/api/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: toolName, params }),
    });
    httpStatus = res.status;
    try {
      responseBody = await res.json();
    } catch {
      responseBody = { raw: await res.text().catch(() => '') };
    }
  } catch (err: any) {
    httpStatus = 0;
    responseBody = { error: err.message };
    consoleErrors.push(`[fetch-error] ${err.message}`);
  }

  // Wait for frontend to react
  await page.waitForTimeout(waitMs);

  // Take screenshot
  const timestamp = new Date();
  const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `${slug}-${timestamp.toISOString().replace(/[:.]/g, '-')}.png`;
  const screenshotPath = path.join(SCREENSHOTS_DIR, filename);
  const screenshot = await page.screenshot({ fullPage: true });
  fs.writeFileSync(screenshotPath, screenshot);

  return {
    screenshot,
    consoleLogs: [...consoleLogs],
    consoleErrors: [...consoleErrors],
    timestamp,
    toolName,
    httpStatus,
    responseBody,
    screenshotPath,
  };
}

/**
 * Directly inject a Wonder Canvas event into the browser page via CustomEvent.
 * This bypasses the Daily/WebSocket relay (which requires an active room)
 * and lets us test the WonderCanvasRenderer + iframe runtime directly.
 */
export async function injectWonderEvent(
  page: Page,
  eventType: string,
  payload: Record<string, any>,
) {
  await page.evaluate(
    ({ eventType, payload }) => {
      window.dispatchEvent(
        new CustomEvent(`nia:${eventType}`, { detail: { payload } }),
      );
    },
    { eventType, payload },
  );
}

/**
 * Render Wonder Canvas content by writing directly into the iframe document.
 * 
 * In headless Chromium, srcdoc iframes with postMessage don't reliably render
 * in screenshots. This method uses document.write() via allow-same-origin to
 * inject content directly, producing accurate visual screenshots.
 * 
 * Also fires the CustomEvent so the React wrapper state updates (active/inactive).
 */
export async function renderWonderCanvas(
  page: Page,
  html: string,
  opts: { css?: string; layer?: string; transition?: string } = {},
) {
  await page.evaluate(
    ({ html, css }) => {
      const el = document.querySelector('[data-testid="wonder-canvas"]');
      if (!el) return;
      const iframe = el.querySelector('iframe');
      if (!iframe) return;

      // Activate the wrapper
      el.classList.remove('wonder-canvas--inactive');
      el.classList.add('wonder-canvas--active');

      // Build full HTML doc with the runtime's CSS presets
      const fullCss = `
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{width:100%;height:100%;overflow:hidden;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e0e0e8}
        .wonder-fadeIn{animation:wFadeIn .5s ease forwards}
        .wonder-slideUp{animation:wSlideUp .4s ease-out forwards}
        .wonder-bounce{animation:wBounce .6s ease}
        .wonder-pulse{animation:wPulse 1s ease infinite}
        .wonder-glow{animation:wGlow 2s ease infinite}
        @keyframes wFadeIn{from{opacity:0}to{opacity:1}}
        @keyframes wSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        @keyframes wBounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-16px)}60%{transform:translateY(-8px)}}
        @keyframes wPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
        @keyframes wGlow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}
        .wonder-choice{display:inline-block;padding:12px 24px;margin:8px;border-radius:12px;
          background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;
          font-size:16px;backdrop-filter:blur(10px);cursor:pointer}
        .wonder-choice:hover{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.4)}
        .wonder-particles-fireflies{position:absolute;inset:0;pointer-events:none;
          background-image:radial-gradient(2px 2px at 20% 30%,rgba(255,220,100,.6),transparent),
            radial-gradient(2px 2px at 60% 70%,rgba(255,220,100,.4),transparent),
            radial-gradient(2px 2px at 80% 20%,rgba(255,220,100,.5),transparent);
          background-size:300px 300px}
        .wonder-particles-sparkle{position:absolute;inset:0;pointer-events:none;
          background-image:radial-gradient(1px 1px at 10% 10%,rgba(255,255,255,.8),transparent),
            radial-gradient(1px 1px at 50% 50%,rgba(200,200,255,.6),transparent),
            radial-gradient(1px 1px at 90% 30%,rgba(255,255,255,.7),transparent);
          background-size:150px 150px}
        ${css || ''}
      `;

      const doc = iframe.contentDocument!;
      doc.open();
      doc.write('<html><head><style>' + fullCss + '</style></head><body style="margin:0;background:transparent">' + html + '</body></html>');
      doc.close();
    },
    { html, css: opts.css },
  );
}

/**
 * Clear the Wonder Canvas by resetting the iframe and deactivating the wrapper.
 */
export async function clearWonderCanvas(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="wonder-canvas"]');
    if (!el) return;
    const iframe = el.querySelector('iframe');
    el.classList.remove('wonder-canvas--active');
    el.classList.add('wonder-canvas--inactive');
    if (iframe?.contentDocument) {
      iframe.contentDocument.open();
      iframe.contentDocument.write('<html><body></body></html>');
      iframe.contentDocument.close();
    }
  });
}

/**
 * Invoke a Wonder Canvas tool by injecting the event directly into the browser,
 * then take a screenshot. This is the reliable path for visual testing since
 * the REST API path requires an active Daily room to relay events.
 */
export async function wonderCanvasAndScreenshot(
  page: Page,
  eventType: string,
  payload: Record<string, any>,
  opts: { waitMs?: number; label?: string; consoleLogs?: string[]; consoleErrors?: string[] } = {},
): Promise<ToolResult> {
  const waitMs = opts.waitMs ?? 1500;
  const label = opts.label ?? eventType;
  const consoleLogs = opts.consoleLogs ?? [];
  const consoleErrors = opts.consoleErrors ?? [];

  // Inject event directly into the page
  await injectWonderEvent(page, eventType, payload);

  // Wait for render
  await page.waitForTimeout(waitMs);

  // Take screenshot
  const timestamp = new Date();
  const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `${slug}-${timestamp.toISOString().replace(/[:.]/g, '-')}.png`;
  const screenshotPath = path.join(SCREENSHOTS_DIR, filename);
  const screenshot = await page.screenshot({ fullPage: true });
  fs.writeFileSync(screenshotPath, screenshot);

  return {
    screenshot,
    consoleLogs: [...consoleLogs],
    consoleErrors: [...consoleErrors],
    timestamp,
    toolName: eventType,
    httpStatus: 200,
    responseBody: { injected: true },
    screenshotPath,
  };
}

/** Add a test report entry (used by the report generator) */
export function addReport(report: TestReport) {
  _reports.push(report);
}

export function getReports() {
  return _reports;
}
