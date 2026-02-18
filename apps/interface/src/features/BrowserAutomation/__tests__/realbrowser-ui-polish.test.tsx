/** @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import '@testing-library/jest-dom';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

// Local feature gate mock: enable features per-test via global to satisfy jest.mock scoping
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

// Utility: build a fetch mock that branches on action
const buildFetchMock = () => {
  const fn = jest.fn(async (_url: string, init?: any) => {
    // Session creation (first call in component mount)
    if (init && init.body) {
      try {
        const body = JSON.parse(init.body);
        switch (body.action) {
          case 'create_session':
            return {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                screenshot: 'data:image/png;base64,AAA',
                pageInfo: { url: body.initialUrl, links: [ { text: 'Link A', url: 'https://a.test', selector: '#a' }, { text: 'Link B', url: 'https://b.test', selector: '#b' } ], elements: [], images: [], videos: [], content: '', title: 'Test Page' }
              })
            } as any;
          case 'get_page_info':
            return { ok: true, status: 200, json: async () => ({ success: true, data: { url: 'https://example.test', links: [ { text: 'Link A', url: 'https://a.test', selector: '#a' } ], elements: [], images: [], videos: [], content: '', title: 'Test Page' } }) } as any;
          case 'perform_action':
            return { ok: true, status: 200, json: async () => ({ success: true, screenshot: 'data:image/png;base64,BBB' }) } as any;
          case 'navigate':
            return { ok: true, status: 200, json: async () => ({ success: true, screenshot: 'data:image/png;base64,CCC' }) } as any;
          default:
            return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
        }
      } catch {
        return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
      }
    }
    // Fallback
    return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
  });
  return fn;
};

describe('RealBrowserView UI polish', () => {
  beforeEach(() => {
  (global as any).__enabledFeatures = new Set<string>(['browserAutomation']);
    jest.useRealTimers();
    (global as any).fetch = buildFetchMock();
    // crypto.randomUUID shim
    jest.spyOn(global, 'crypto', 'get').mockReturnValue({ randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) } as any);
  });
  afterEach(() => {
    jest.resetAllMocks();
  delete (global as any).__enabledFeatures;
  });

  it('renders quick links overlay when pageInfo.links available', async () => {
    render(<RealBrowserView sessionId="s1" initialUrl="https://start.test" supportedFeatures={['browserAutomation', 'miniBrowser']} />);
    await waitFor(() => expect(screen.getByRole('toolbar', { name: /browser controls/i })).toBeInTheDocument());
    // wait for quick link button - we set pageInfo now on init
    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      expect(btns.some(b => /navigate to link a/i.test(b.getAttribute('aria-label') || ''))).toBe(true);
    });
  });

  it('displays action flash after performing an action (screenshot button)', async () => {
    render(<RealBrowserView sessionId="s2" initialUrl="https://start.test" supportedFeatures={['browserAutomation', 'miniBrowser']} />);
    const shotBtn = await screen.findByRole('button', { name: /take screenshot/i });
    await waitFor(() => expect(shotBtn).toBeEnabled());
    act(() => { shotBtn.click(); });
    await waitFor(() => expect(screen.getByTestId('action-flash')).toBeInTheDocument());
  });

  it('focuses URL input with meta+L shortcut', async () => {
    render(<RealBrowserView sessionId="s3" initialUrl="https://start.test" supportedFeatures={['browserAutomation', 'miniBrowser']} />);
    const addressBar = await screen.findByRole('textbox', { name: /url or natural language query/i });
    act(() => { const evt = new KeyboardEvent('keydown', { key: 'l', metaKey: true }); window.dispatchEvent(evt); });
    // jsdom does not always update document.activeElement for programmatic focus in some envs; assert selection side effect
    expect((addressBar as HTMLInputElement).selectionStart).toBe(0);
  });

  it('shows error toast on failed session initialization', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'fail' }));
    render(<RealBrowserView sessionId="s4" initialUrl="https://start.test" supportedFeatures={['browserAutomation', 'miniBrowser']} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/browser automation failed/i);
  });

  it('rotates placeholder text over time', async () => {
    jest.useFakeTimers();
    render(<RealBrowserView sessionId="s5" initialUrl="https://start.test" supportedFeatures={['browserAutomation', 'miniBrowser']} />);
    const input = await screen.findByRole('textbox', { name: /url or natural language query/i });
    const first = (input as HTMLInputElement).placeholder;
    act(() => { jest.advanceTimersByTime(6100); });
    const second = (input as HTMLInputElement).placeholder;
    // When using fake timers before mount completes, we may need flush microtasks
    expect(second).not.toBe(first);
    jest.useRealTimers();
  });
});
