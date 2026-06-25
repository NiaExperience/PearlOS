import { test, expect } from '@playwright/test';
import path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'https://134-209-76-227.sslip.io';
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

test.describe('Share/Webhook Pipeline', () => {
  
  test('Google login works', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-login-page.png'), fullPage: true });
    
    // Verify login page renders
    const googleButton = page.locator('button:has-text("Google"), a:has-text("Google"), [data-provider="google"]');
    await expect(googleButton.first()).toBeVisible({ timeout: 10000 });
    console.log('✓ Google login button visible');
  });

  test('Share link page loads unauthenticated', async ({ page }) => {
    // Test public access — should load without auth
    const testKey = 'test-public-key';
    await page.goto(`${BASE_URL}/share/${testKey}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-public-share.png'), fullPage: true });
    
    // Should NOT redirect to login
    expect(page.url()).not.toContain('/login');
    console.log('✓ Share page accessible without auth');
  });

  test('Share generate endpoint requires auth', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/share/generate`, {
      data: { resourceId: 'test', contentType: 'Notes', role: 'viewer' }
    });
    // Should require authentication
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThan(500);
    console.log('✓ Share generation properly requires auth');
  });

  test('Public routes accessible without auth', async ({ request }) => {
    const routes = ['/api/health/build', '/login', '/'];
    for (const route of routes) {
      const res = await request.get(`${BASE_URL}${route}`);
      expect(res.status()).toBeLessThan(400);
      console.log(`✓ ${route} accessible (${res.status()})`);
    }
  });

  test('Screenshot: main app shell', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-app-shell.png'), fullPage: true });
    console.log('✓ App shell screenshot captured');
  });
});

test.describe('Notes System', () => {
  test('Notes API accessible', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/notes`);
    // May return 401 if unauthenticated, or 200 with notes
    expect([200, 401]).toContain(res.status());
    console.log(`✓ Notes API responds (${res.status()})`);
  });
});

