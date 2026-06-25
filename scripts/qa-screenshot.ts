/**
 * PearlOS QA Screenshot Script
 *
 * Authenticates against the Dashboard login, waits for the ActiveJobsWidget,
 * captures a timestamped screenshot of the widget, and saves it to
 * /qa/screenshots/.
 *
 * Environment variables (read from .env.local by default):
 *   DASHBOARD_ADMIN_EMAIL    - login email
 *   DASHBOARD_ADMIN_PASSWORD - login password
 *   PEARLOS_URL              - base URL (default: http://localhost:3000)
 *   DISCORD_QA_WEBHOOK       - Discord webhook URL for screenshot delivery (optional)
 *
 * Usage:
 *   npx tsx scripts/qa-screenshot.ts
 */

import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import FormData from 'form-data';

// Load env with explicit path
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const BASE_URL = process.env.PEARLOS_URL || 'https://added-engine-disclosure-explosion.trycloudflare.com';
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'qa', 'screenshots');
const DISCORD_QA_WEBHOOK = process.env.DISCORD_QA_WEBHOOK;

// Pearl bot test account only — never log in as a real human user.
const EMAIL = process.env.DASHBOARD_ADMIN_EMAIL || 'pearl@niaxp.com';
const PASSWORD = process.env.DASHBOARD_ADMIN_PASSWORD || 'pearlos2026';

async function authenticate(page: Page): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'Missing DASHBOARD_ADMIN_EMAIL or DASHBOARD_ADMIN_PASSWORD in environment',
    );
  }

  // Navigate to login page
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Target by ID for stability
  const emailInput = page.locator('#email-input');
  const passwordInput = page.locator('#password-input');

  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  await emailInput.fill(EMAIL);
  await passwordInput.fill(PASSWORD);

  // Submit via the Sign In button
  await page.click('button[type="submit"]');

  // Wait for navigation away from /login
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 30_000,
  });

  // Extra settle time for React hydration
  await page.waitForTimeout(3000);
}

async function waitForActiveJobsWidget(page: Page): Promise<void> {
  // The ActiveJobsWidget injects a <style id="gohufont-active-jobs"> tag
  // when it mounts. We wait for that as a fingerprint.
  try {
    await page.waitForFunction(
      () => !!document.getElementById('gohufont-active-jobs'),
      { timeout: 20_000 },
    );
  } catch {
    console.warn(
      'ActiveJobsWidget font-face tag not found — widget may not be rendered. Continuing anyway.',
    );
  }

  // Let animations settle
  await page.waitForTimeout(2000);
}

function screenshotFilename(label: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `${slug}-${ts}.png`;
}

async function sendToDiscord(screenshotPaths: string[]): Promise<void> {
  if (!DISCORD_QA_WEBHOOK) {
    console.log('DISCORD_QA_WEBHOOK not set — skipping Discord delivery.');
    return;
  }

  const form = new FormData();

  const ts = new Date().toISOString();
  const embed = {
    title: 'QA Screenshot Report',
    description: `Captured ${screenshotPaths.length} screenshot(s) at ${ts}`,
    color: 0x00bfff,
    timestamp: ts,
    fields: screenshotPaths.map((p, i) => ({
      name: `Screenshot ${i + 1}`,
      value: path.basename(p),
    })),
  };

  form.append(
    'payload_json',
    JSON.stringify({
      username: 'PearlOS QA Bot',
      embeds: [embed],
    }),
  );

  for (let i = 0; i < screenshotPaths.length; i++) {
    form.append(`files[${i}]`, fs.createReadStream(screenshotPaths[i]), {
      filename: path.basename(screenshotPaths[i]),
      contentType: 'image/png',
    });
  }

  const resp = await new Promise<{ statusCode: number | undefined }>((resolve, reject) => {
    form.submit(DISCORD_QA_WEBHOOK!, (err, res) => {
      if (err) return reject(err);
      res.resume();
      resolve({ statusCode: res.statusCode });
    });
  });

  if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) {
    console.log('Screenshots delivered to Discord successfully.');
  } else {
    console.error(`Discord webhook returned status ${resp.statusCode}`);
  }
}

async function main() {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    console.log(`Navigating to ${BASE_URL} ...`);

    // Authenticate
    await authenticate(page);
    console.log('Authenticated.');

    // Navigate to main page (may already be there after login redirect)
    if (!page.url().includes(BASE_URL) || page.url().includes('/login')) {
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    }

    // Wait for ActiveJobsWidget
    await waitForActiveJobsWidget(page);
    console.log('ActiveJobsWidget detected (or timeout reached).');

    // Full-page screenshot
    const fullPath = path.join(SCREENSHOTS_DIR, screenshotFilename('pearlos-full'));
    await page.screenshot({ path: fullPath, fullPage: true });
    console.log(`Full-page screenshot saved: ${fullPath}`);

    // Targeted ActiveJobsWidget screenshot (best-effort selector)
    const widgetSelectors = [
      '[data-testid="active-jobs-widget"]',
      '#gohufont-active-jobs ~ *',
      '.active-jobs-widget',
      '[class*="ActiveJobs"]',
    ];

    let widgetScreenshotPath: string | null = null;
    for (const selector of widgetSelectors) {
      const el = await page.$(selector);
      if (el) {
        widgetScreenshotPath = path.join(
          SCREENSHOTS_DIR,
          screenshotFilename('active-jobs-widget'),
        );
        await el.screenshot({ path: widgetScreenshotPath });
        console.log(`Widget screenshot saved: ${widgetScreenshotPath}`);
        break;
      }
    }

    if (!widgetScreenshotPath) {
      console.warn(
        'Could not locate ActiveJobsWidget element for targeted screenshot. ' +
          'Full-page screenshot was still captured.',
      );
    }

    // Deliver screenshots to Discord
    const screenshotsToSend = [fullPath];
    if (widgetScreenshotPath) {
      screenshotsToSend.push(widgetScreenshotPath);
    }
    await sendToDiscord(screenshotsToSend);

    console.log('QA screenshot workflow complete.');
  } catch (err) {
    // Save a failure screenshot for debugging
    const failPath = path.join(SCREENSHOTS_DIR, screenshotFilename('failure'));
    await page.screenshot({ path: failPath, fullPage: true }).catch(() => {});
    console.error('Screenshot workflow failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
