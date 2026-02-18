/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, render } from '@testing-library/react';
import React from 'react';

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { VoiceSessionProvider } from '@interface/contexts/voice-session-context';
import { DailyCallStateProvider } from '@interface/features/DailyCall/state/store';

import RealBrowserView from '../src/features/BrowserAutomation/components/RealBrowserView';
import { HtmlGenerationFlow } from '../src/features/HtmlGeneration/components/HtmlGenerationFlow';

// Local feature gate mock (global Set to satisfy jest.mock scoping)
jest.mock('@nia/features', () => ({
  __esModule: true,
  isFeatureEnabled: (key: string) => !!(global as any).__enabledFeatures && (global as any).__enabledFeatures.has(key),
  guardFeature: (key: string, onDisabled: any, onEnabled: any) => {
    const set = (global as any).__enabledFeatures as Set<string> | undefined;
    return set && set.has(key) ? onEnabled() : onDisabled();
  },
  featureFlags: new Proxy({}, {
    get(_target, prop: string) {
      const set = (global as any).__enabledFeatures as Set<string> | undefined;
      return set && set.has(prop);
    }
  }),
  setAssistantSupportedFeatures: () => {},
  featureDefinitions: {},
  featureRegistry: {},
  default: {},
}));

// This test simulates simultaneous BrowserAutomation navigation, speech events, and HTML generation
// to ensure no cross-feature interference (global timers, abort controllers, event dispatch).

describe('Cross Feature Concurrency', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
  (global as any).__enabledFeatures = new Set<string>(['browserAutomation', 'htmlContent']);
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
    // Initial browser session bootstrap mock
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, screenshot: 'data:image/png;base64,AAA', pageInfo: { url: 'https://seed.com' } })
    }));
    jest.spyOn(global, 'crypto', 'get').mockReturnValue({ randomUUID: () => 'sess1' } as any);
  });
  afterEach(() => {
    try {
      delete (window as any).activeBrowserNavigate;
      delete (window as any).activeBrowserQueue;
    } catch { /* ignore */ }
    jest.clearAllTimers();
  delete (global as any).__enabledFeatures;
  });

  function queueHtmlResponses() {
    // Fast then advanced html generation responses interleaved with browser action responses
    fetchMock.mockImplementation((url: string, req: any) => {
      if (url.includes('/api/html-generation')) {
        const body = JSON.parse(req.body);
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { htmlContent: `<p>${body.useOpenAI ? 'Fast' : 'Adv'} Content</p>`, aiProvider: body.useOpenAI ? 'openai' : 'anthropic', title: body.title, contentType: 'game' } }) }) as any;
      }
      if (req?.body) {
        try {
          const parsed = JSON.parse(req.body);
          if (parsed.action === 'navigate') {
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) }) as any;
          }
          if (parsed.action === 'perform_action') {
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, screenshot: 'data:image/png;base64,BBB' }) }) as any;
          }
        } catch { /* ignore */ }
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) }) as any;
    });
  }

  it('runs browser navigation, speech events, and dual html generations concurrently', async () => {
    queueHtmlResponses();

    const speechEvents: any[] = [];
    const SpeechConsumer: React.FC = () => {
      React.useEffect(() => {
        const handler = (e: any) => speechEvents.push({ name: e.type, detail: e.detail });
        window.addEventListener('speech.vapi.telemetry', handler as any);
        window.addEventListener('speech.vapi.start', handler as any);
        window.addEventListener('speech.vapi.end', handler as any);
        return () => {
          window.removeEventListener('speech.vapi.telemetry', handler as any);
          window.removeEventListener('speech.vapi.start', handler as any);
          window.removeEventListener('speech.vapi.end', handler as any);
        };
      }, []);
      return null;
    };

    await act(async () => {
      render(
        <DailyCallStateProvider>
          <DesktopModeProvider>
            <VoiceSessionProvider>
              <SpeechConsumer />
              <div>
                <RealBrowserView sessionId="sess1" initialUrl="https://start.com" supportedFeatures={['browserAutomation', 'miniBrowser']} />
                <HtmlGenerationFlow request="Create fast game" mode="fast" id="f" />
                <HtmlGenerationFlow request="Create advanced game" mode="advanced" id="a" />
              </div>
            </VoiceSessionProvider>
          </DesktopModeProvider>
        </DailyCallStateProvider>
      );
    });

    // Trigger a navigation + queued perform action while html is generating and speech events fire
    act(() => {
      (window as any).activeBrowserNavigate && (window as any).activeBrowserNavigate('https://concurrent.com');
      // Dispatch artificial speech start + telemetry
      window.dispatchEvent(new CustomEvent('speech.vapi.start', { detail: { id: 's1' } }));
      window.dispatchEvent(new CustomEvent('speech.vapi.telemetry', { detail: { packets: 1 } }));
      window.dispatchEvent(new CustomEvent('speech.vapi.end', { detail: { id: 's1' } }));
    });

    // Allow promises to settle
    await act(async () => { await Promise.resolve(); });

    // Assertions: html generations ready, providers correct, speech events captured, browser global still present
    expect((window as any).activeBrowserNavigate).toBeTruthy();
    const fastProvider = document.querySelector('[data-testid="f-provider"]')?.textContent;
    const advProvider = document.querySelector('[data-testid="a-provider"]')?.textContent;
    expect(fastProvider).toBe('openai');
    expect(advProvider).toBe('anthropic');
    const names = speechEvents.map(e => e.name);
    // Allow possible leading telemetry events; ensure required sequence occurs in order
    const startIndex = names.indexOf('speech.vapi.start');
    const teleIndex = names.indexOf('speech.vapi.telemetry', startIndex + 1);
    const endIndex = names.indexOf('speech.vapi.end', teleIndex + 1);
    expect(startIndex).toBeGreaterThan(-1);
    expect(teleIndex).toBeGreaterThan(-1);
    expect(endIndex).toBeGreaterThan(-1);
  });
});
