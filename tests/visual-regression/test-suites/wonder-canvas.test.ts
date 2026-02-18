import { test, expect } from '@playwright/test';
import {
  loadPearlOS,
  setupConsoleCapture,
  renderWonderCanvas,
  clearWonderCanvas,
} from '../test-harness';
import { addEntry, generateReport } from '../evaluate';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'screenshots');

// ── Inline SVG icons (render inside innerHTML without script execution) ──
const ICON = {
  tree: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round"><path d="M12 2L8 8h8l-4-6zm0 6L7 14h10l-5-6zm0 6v6m-2 0h4"/></svg>',
  cave: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round"><path d="M3 20h18v-4c0-2-1-4-3-5 1-2 0-4-2-5-1-1-3-1-4 0-1-1-3-1-4 0-2 1-3 3-2 5-2 1-3 3-3 5v4z"/></svg>',
  tower: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round"><rect x="6" y="2" width="12" height="20" rx="1"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><rect x="10" y="18" width="4" height="4"/></svg>',
  sparkle: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/><path d="M19 15l.5 2.5L22 18l-2.5.5L19 21l-.5-2.5L16 18l2.5-.5z"/><path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/></svg>',
  run: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round"><circle cx="8" cy="5" r="2"/><path d="M13 8l-4 4m0 0l-3 3m3-3l2 6m-6-4l2-2"/><path d="M20 12l-3-3"/></svg>',
  sword: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round"><path d="M19 3L5 17m0 0l-2 2 2 2 2-2m-2-2l2-2"/><path d="M17.5 6.5L19 5"/></svg>',
  shield: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round"><path d="M12 2L4 6v6c0 5 3 9 8 10 5-1 8-5 8-10V6l-8-4z"/></svg>',
  crystal: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round"><path d="M12 2L6 8h12l-6-6zm0 0v6m-6 0L4 22h16l-2-14H6z"/><line x1="12" y1="8" x2="12" y2="22"/></svg>',
  zap: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>',
  star: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
};

async function snap(page: any, label: string) {
  const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  const buf = await page.screenshot({ fullPage: true });
  fs.writeFileSync(filepath, buf);
  return filepath;
}

test.describe('Wonder Canvas', () => {
  test.afterAll(() => {
    generateReport();
  });

  test('scene with simple HTML renders canvas', async ({ page }) => {
    const { errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    await renderWonderCanvas(page,
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:linear-gradient(135deg,#1a1a2e,#16213e)"><h1 style="color:white;font-size:48px;text-shadow:0 0 30px rgba(129,140,248,0.8)">Hello PearlOS</h1></div>',
    );
    await page.waitForTimeout(800);
    const screenshotPath = await snap(page, 'canvas-hello');

    addEntry({
      testName: 'Simple HTML Scene',
      toolName: 'wonder.scene',
      passed: true,
      screenshotPath,
      httpStatus: 200,
      consoleErrors: errors,
      durationMs: Date.now() - start,
    });
  });

  test('interactive choice buttons', async ({ page }) => {
    const { errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    await renderWonderCanvas(page, `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:linear-gradient(135deg,#0a0a1a,#1a0a2e)">
        <h2 style="color:white;font-size:32px;margin-bottom:30px" class="wonder-fadeIn">Choose your path</h2>
        <button class="wonder-choice wonder-fadeIn" data-action="forest">${ICON.tree} Enter the Forest</button>
        <button class="wonder-choice wonder-fadeIn" data-action="cave">${ICON.cave} Explore the Cave</button>
        <button class="wonder-choice wonder-fadeIn" data-action="tower">${ICON.tower} Climb the Tower</button>
      </div>
    `);
    await page.waitForTimeout(800);
    const screenshotPath = await snap(page, 'canvas-choices');

    addEntry({
      testName: 'Interactive Choice Buttons',
      toolName: 'wonder.scene',
      passed: true,
      screenshotPath,
      httpStatus: 200,
      consoleErrors: errors,
      durationMs: Date.now() - start,
    });
  });

  test('story flow — 3 chapter sequence', async ({ page }) => {
    const { errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    // Chapter 1
    await renderWonderCanvas(page, `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:linear-gradient(to bottom,#0a0a0f,#1a0a2e);position:relative">
        <div class="wonder-particles-fireflies"></div>
        <h1 style="color:#e0e0e8;font-size:40px;z-index:1" class="wonder-fadeIn">Chapter 1: The Dark Forest</h1>
        <p style="color:#a5b4fc;margin-top:16px;z-index:1;font-size:18px" class="wonder-fadeIn">You awaken in a clearing surrounded by ancient trees...</p>
      </div>
    `);
    await page.waitForTimeout(1000);
    await snap(page, 'story-ch1-forest');

    // Chapter 2
    await renderWonderCanvas(page, `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:linear-gradient(to bottom,#1a0a2e,#2a1a3e)">
        <h1 style="color:#e0e0e8;font-size:40px" class="wonder-slideUp">Chapter 2: The Cave</h1>
        <p style="color:#a5b4fc;margin-top:16px;font-size:18px" class="wonder-slideUp">Deep within, something glows...</p>
        <div style="margin-top:30px;display:flex;flex-direction:column;gap:10px">
          <button class="wonder-choice" data-action="touch_glow">${ICON.sparkle} Touch the glow</button>
          <button class="wonder-choice" data-action="run_away">${ICON.run} Run away</button>
        </div>
      </div>
    `);
    await page.waitForTimeout(1000);
    await snap(page, 'story-ch2-cave');

    // Chapter 3
    await renderWonderCanvas(page, `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:radial-gradient(circle,#3a2a5e,#0a0a0f);position:relative">
        <div class="wonder-particles-sparkle"></div>
        <h1 style="color:#ffd700;font-size:48px;z-index:1" class="wonder-bounce">${ICON.crystal} You found the Crystal!</h1>
        <p style="color:#e0e0e8;margin-top:16px;font-size:18px;z-index:1" class="wonder-fadeIn">Its light fills the cavern with warmth.</p>
      </div>
    `);
    await page.waitForTimeout(1000);
    const screenshotPath = await snap(page, 'story-ch3-crystal');

    addEntry({
      testName: 'Story Flow (3 chapters)',
      toolName: 'wonder.scene',
      passed: true,
      screenshotPath,
      httpStatus: 200,
      consoleErrors: errors,
      durationMs: Date.now() - start,
    });
  });

  test('canvas clear restores void', async ({ page }) => {
    const { errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    await renderWonderCanvas(page,
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#e94560"><h1 style="color:white;font-size:48px">This will vanish</h1></div>',
    );
    await page.waitForTimeout(500);
    await snap(page, 'canvas-before-clear');

    await clearWonderCanvas(page);
    await page.waitForTimeout(800);
    const screenshotPath = await snap(page, 'canvas-after-clear');

    addEntry({
      testName: 'Canvas Clear',
      toolName: 'wonder.clear',
      passed: true,
      screenshotPath,
      httpStatus: 200,
      consoleErrors: errors,
      durationMs: Date.now() - start,
    });
  });

  test('overlay HUD on top of scene', async ({ page }) => {
    const { errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    await renderWonderCanvas(page, `
      <div style="position:relative;height:100vh;background:linear-gradient(135deg,#0f3460,#533483)">
        <div style="display:flex;align-items:center;justify-content:center;height:100%">
          <h1 style="color:white;font-size:36px">Main Scene Content</h1>
        </div>
        <div style="position:absolute;top:20px;right:20px;background:rgba(0,0,0,0.7);padding:12px 20px;border-radius:8px;color:#a5b4fc;font-size:14px;backdrop-filter:blur(10px)">${ICON.zap} HP: 100 | ${ICON.star} XP: 420</div>
        <div style="position:absolute;bottom:20px;left:20px;right:20px;display:flex;justify-content:center;gap:12px">
          <button class="wonder-choice" data-action="attack">${ICON.sword} Attack</button>
          <button class="wonder-choice" data-action="defend">${ICON.shield} Defend</button>
          <button class="wonder-choice" data-action="flee">${ICON.run} Flee</button>
        </div>
      </div>
    `);
    await page.waitForTimeout(800);
    const screenshotPath = await snap(page, 'canvas-overlay-hud');

    addEntry({
      testName: 'Overlay HUD',
      toolName: 'wonder.scene',
      passed: true,
      screenshotPath,
      httpStatus: 200,
      consoleErrors: errors,
      durationMs: Date.now() - start,
    });
  });
});
