import { test, expect } from '@playwright/test';
import {
  loadPearlOS,
  setupConsoleCapture,
  invokeToolAndScreenshot,
} from '../test-harness';
import { addEntry, generateReport } from '../evaluate';

test.describe('Core PearlOS Tools', () => {
  test.afterAll(() => {
    generateReport();
  });

  test('open notes panel', async ({ page }) => {
    const { logs, errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    const result = await invokeToolAndScreenshot(
      page,
      'bot_open_notes',
      {},
      { label: 'open-notes', consoleLogs: logs, consoleErrors: errors },
    );

    addEntry({
      testName: 'Open Notes',
      toolName: 'bot_open_notes',
      passed: result.httpStatus === 200 || result.httpStatus === 0,
      screenshotPath: result.screenshotPath,
      httpStatus: result.httpStatus,
      consoleErrors: result.consoleErrors,
      durationMs: Date.now() - start,
    });

    expect(result.screenshot.length).toBeGreaterThan(0);
  });

  test('create note with title and content', async ({ page }) => {
    const { logs, errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    const result = await invokeToolAndScreenshot(
      page,
      'bot_create_note',
      {
        title: 'Test Note from Visual Regression',
        content: 'This note was created by the automated visual regression test harness.',
      },
      { label: 'create-note', consoleLogs: logs, consoleErrors: errors },
    );

    addEntry({
      testName: 'Create Note',
      toolName: 'bot_create_note',
      passed: result.httpStatus === 200 || result.httpStatus === 0,
      screenshotPath: result.screenshotPath,
      httpStatus: result.httpStatus,
      consoleErrors: result.consoleErrors,
      durationMs: Date.now() - start,
      note: `Response: ${JSON.stringify(result.responseBody).slice(0, 200)}`,
    });
  });

  test('open YouTube panel', async ({ page }) => {
    const { logs, errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    const result = await invokeToolAndScreenshot(
      page,
      'bot_open_youtube',
      {},
      { label: 'open-youtube', consoleLogs: logs, consoleErrors: errors },
    );

    addEntry({
      testName: 'Open YouTube',
      toolName: 'bot_open_youtube',
      passed: result.httpStatus === 200 || result.httpStatus === 0,
      screenshotPath: result.screenshotPath,
      httpStatus: result.httpStatus,
      consoleErrors: result.consoleErrors,
      durationMs: Date.now() - start,
    });
  });

  test('play soundtrack (no crash in headless)', async ({ page }) => {
    const { logs, errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    const result = await invokeToolAndScreenshot(
      page,
      'bot_play_soundtrack',
      { soundtrack: 'chill' },
      { label: 'play-soundtrack', consoleLogs: logs, consoleErrors: errors },
    );

    // Audio won't play in headless, but it shouldn't cause page errors
    const hasCriticalError = result.consoleErrors.some(
      (e) => e.includes('Uncaught') || e.includes('TypeError') || e.includes('ReferenceError'),
    );

    addEntry({
      testName: 'Play Soundtrack',
      toolName: 'bot_play_soundtrack',
      passed: !hasCriticalError,
      screenshotPath: result.screenshotPath,
      httpStatus: result.httpStatus,
      consoleErrors: result.consoleErrors,
      durationMs: Date.now() - start,
      note: hasCriticalError ? 'Critical JS error detected' : 'No critical errors (audio expected to not play in headless)',
    });
  });

  test('open calculator', async ({ page }) => {
    const { logs, errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    const result = await invokeToolAndScreenshot(
      page,
      'bot_open_calculator',
      {},
      { label: 'open-calculator', consoleLogs: logs, consoleErrors: errors },
    );

    addEntry({
      testName: 'Open Calculator',
      toolName: 'bot_open_calculator',
      passed: result.httpStatus === 200 || result.httpStatus === 0,
      screenshotPath: result.screenshotPath,
      httpStatus: result.httpStatus,
      consoleErrors: result.consoleErrors,
      durationMs: Date.now() - start,
    });
  });

  test('close notes panel', async ({ page }) => {
    const { logs, errors } = setupConsoleCapture(page);
    await loadPearlOS(page);
    const start = Date.now();

    // Open notes first, then close
    await invokeToolAndScreenshot(
      page,
      'bot_open_notes',
      {},
      { label: 'close-notes-setup', consoleLogs: logs, consoleErrors: errors, waitMs: 1000 },
    );

    const result = await invokeToolAndScreenshot(
      page,
      'bot_close_notes',
      {},
      { label: 'close-notes', consoleLogs: logs, consoleErrors: errors },
    );

    addEntry({
      testName: 'Close Notes',
      toolName: 'bot_close_notes',
      passed: result.httpStatus === 200 || result.httpStatus === 0,
      screenshotPath: result.screenshotPath,
      httpStatus: result.httpStatus,
      consoleErrors: result.consoleErrors,
      durationMs: Date.now() - start,
    });
  });
});
