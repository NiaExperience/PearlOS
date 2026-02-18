/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { getLogger } from '@interface/lib/logger';

// Local feature gate mock using global to satisfy jest.mock scoping rules
jest.mock('@nia/features', () => ({
  __esModule: true,
  isFeatureEnabled: (key: string) => !!(global as any).__enabledFeatures && (global as any).__enabledFeatures.has(key),
  guardFeature: (key: string, onDisabled: any, onEnabled: any) => {
    const set = (global as any).__enabledFeatures as Set<string> | undefined;
    return set && set.has(key) ? onEnabled() : onDisabled();
  },
  setAssistantSupportedFeatures: () => {},
  featureDefinitions: {},
  featureRegistry: {},
  default: {},
}));

import RealBrowserView from '../components/RealBrowserView';

// Mock fetch for session creation & actions
const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

function mockSessionSuccess(url = 'https://example.com') {
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, screenshot: 'data:image/png;base64,AAA', pageInfo: { url } })
  }));
}

describe('RealBrowserView integration event ordering', () => {
  const logger = getLogger('RealBrowserViewIntegrationTest');
  const events: Array<{ name: string; detail: any }> = [];
  const handlers: Record<string, EventListener> = {};
  const capture = (name: string) => (e: Event) => events.push({ name, detail: (e as CustomEvent).detail });
  const eventNames = [
    'browser.queue.enqueue',
    'browser.queue.dequeue',
    'browser.action.success',
    'browser.action.retry',
    'browser.action.failed'
  ];
  const addListeners = () => {
    eventNames.forEach(n => { const h = capture(n); handlers[n] = h; window.addEventListener(n, h); });
  };
  const removeListeners = () => {
    eventNames.forEach(n => { const h = handlers[n]; if (h) window.removeEventListener(n, h); });
  };

  beforeEach(() => {
  (global as any).__enabledFeatures = new Set<string>(['browserAutomation']);
    events.length = 0;
    fetchMock.mockReset();
    mockSessionSuccess();
    addListeners();
    jest.spyOn(global, 'crypto', 'get').mockReturnValue({
      randomUUID: () => Math.random().toString(36).slice(2)
    } as any);
  });
  afterEach(() => {
    removeListeners();
    jest.clearAllTimers();
    jest.useRealTimers();
  delete (global as any).__enabledFeatures;
  });
  afterAll(() => {
    try {
      delete (window as any).activeBrowserNavigate;
      delete (window as any).activeBrowserParseUrl;
      delete (window as any).activeBrowserSessionId;
      delete (window as any).activeBrowserSessionActive;
      delete (window as any).activeBrowserQueue;
    } catch { /* ignore */ }
    jest.clearAllTimers();
    if (typeof (global as any).gc === 'function') { try { (global as any).gc(); } catch { /* ignore */ } }
  });

  it('processes navigate then action with retry on failure and success ordering', async () => {
    const sessionId = crypto.randomUUID();
    await act(async () => {
      render(React.createElement(RealBrowserView, { sessionId, initialUrl: 'https://start.com', supportedFeatures: ['browserAutomation', 'miniBrowser'] }));
    });

    // Simulate action API: first perform_action call fails, second succeeds
    let performAttempts = 0;
    fetchMock.mockImplementation(async (_url: string, req: any) => {
      if (req?.body) {
        try {
          const body = JSON.parse(req.body);
          if (body.action === 'navigate') {
            return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
          }
          if (body.action === 'perform_action') {
            performAttempts++;
            if (performAttempts === 1) {
              return { ok: true, status: 200, json: async () => ({ success: false, error: 'fail' }) } as any; // logical failure triggers throw
            }
            return { ok: true, status: 200, json: async () => ({ success: true, screenshot: 'data:image/png;base64,BBB' }) } as any; // retry succeeds
          }
        } catch { /* ignore */ }
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    });

    // Enqueue a navigate request
    act(() => {
      (window as any).activeBrowserNavigate && (window as any).activeBrowserNavigate('https://nav1.com');
    });

    // Enqueue a perform action immediately (original behavior)
    act(() => {
      const qRef = (window as any).activeBrowserQueue as { current: any[] };
      const id = 'action1';
      qRef.current.push({ id, kind: 'perform', payload: { actionData: { type: 'click', selector: '#btn' } }, createdAt: Date.now(), retries: 0 });
      window.dispatchEvent(new CustomEvent('browser.queue.enqueue', { detail: { id, kind: 'perform', size: qRef.current.length } }));
    });

    // Wait until we have both a navigate success and a perform success (with retry in between) instead of fixed sleeps
    await waitFor(() => {
      const retrySeen = events.some(e => e.name === 'browser.action.retry');
      const navigateIdx = events.findIndex(e => e.name === 'browser.action.success' && e.detail.kind === 'navigate');
      const performIdx = events.findIndex(e => e.name === 'browser.action.success' && e.detail.kind === 'perform');
      expect(retrySeen).toBe(true);
      expect(navigateIdx).toBeGreaterThan(-1);
      expect(performIdx).toBeGreaterThan(-1);
      expect(performIdx).toBeGreaterThan(navigateIdx);
    }, { timeout: 2500 });

    const names = events.map(e => e.name);
    const retries = events.filter(e => e.name === 'browser.action.retry');
    const successes = events.filter(e => e.name === 'browser.action.success');

    if (retries.length === 0) {
      logger.debug('DEBUG events sequence (no retry observed)', { events });
    }

    expect(names.filter(n => n === 'browser.queue.enqueue').length).toBeGreaterThanOrEqual(2);
    expect(names.includes('browser.queue.dequeue')).toBe(true);
    expect(retries.length).toBeGreaterThanOrEqual(1);
    expect(successes.filter(s => ['navigate','perform'].includes(s.detail.kind)).length).toBeGreaterThanOrEqual(2);

    const retryIndex = events.findIndex(e => e.name === 'browser.action.retry');
    const finalPerformSuccessIndex = events.findIndex((e, idx) => e.name === 'browser.action.success' && e.detail.kind === 'perform' && idx > retryIndex);
    expect(retryIndex).toBeGreaterThan(-1);
    expect(finalPerformSuccessIndex).toBeGreaterThan(retryIndex);
  });
});
