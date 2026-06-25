import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Check what inputs exist
  const inputs = await page.$$eval('input', els => els.map(e => ({ id: e.id, name: e.name, type: e.type, placeholder: e.placeholder })));
  console.log('Inputs:', JSON.stringify(inputs, null, 2));

  const buttons = await page.$$eval('button', els => els.map(e => ({ type: e.type, text: e.textContent?.trim() })));
  console.log('Buttons:', JSON.stringify(buttons, null, 2));

  // Fill and submit
  const emailInput = page.locator('#email-input, input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('#password-input, input[type="password"], input[name="password"]').first();

  console.log('Email input visible:', await emailInput.isVisible().catch(() => false));
  console.log('Password input visible:', await passwordInput.isVisible().catch(() => false));

  await emailInput.fill('dev@niaxa.com');
  await passwordInput.fill('harbour');
  await page.click('button[type="submit"]');

  // Wait and check
  await page.waitForTimeout(5000);
  console.log('URL after submit:', page.url());

  // Check page content for errors
  const text = await page.textContent('body');
  const lines = (text || '').split('\n').filter(l => l.trim()).slice(0, 20);
  console.log('Page text (first 20 lines):', lines.join(' | '));

  await page.screenshot({ path: 'qa/screenshots/debug-login.png', fullPage: true });
  console.log('Debug screenshot saved');

  await browser.close();
}

main();
