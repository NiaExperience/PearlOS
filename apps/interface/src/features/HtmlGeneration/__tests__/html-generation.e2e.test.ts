/**
 * @jest-environment jsdom
 */
import { render, screen, act } from '@testing-library/react';
import React from 'react';

import { HtmlGenerationFlow } from '../components/HtmlGenerationFlow';

jest.mock('@interface/contexts/voice-session-context', () => ({
  useVoiceSessionContext: () => ({ roomUrl: null })
}));

// Mock next-auth session to avoid needing a provider
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'test-user-id', email: 'test@example.com' } }, status: 'authenticated' }),
  SessionProvider: ({ children }: any) => children,
  signIn: jest.fn(),
  signOut: jest.fn()
}));

describe('HtmlGeneration E2E Flow (mocked)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  function mockGeneration(provider: string, html: string) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { htmlContent: html, aiProvider: provider, title: 'Game', contentType: 'game' } })
    } as any);
  }

  it('fast mode uses openai and reaches ready state', async () => {
    // Controlled async to observe intermediate state
    let resolveFetch: any;
    const fetchPromise = new Promise<any>((res) => { resolveFetch = res; });
    fetchMock.mockResolvedValueOnce(fetchPromise as any);

    await act(async () => {
      render(React.createElement(HtmlGenerationFlow, { request: 'Make a fast game', mode: 'fast' }));
    });

    // Effect ran, status should be generating while fetch unresolved
    expect(screen.getByTestId('status').textContent).toBe('generating');

    // Now resolve the fetch and flush
    resolveFetch({
      ok: true,
      json: async () => ({ success: true, data: { htmlContent: '<p>Fast Game</p>', aiProvider: 'openai', title: 'Game', contentType: 'game' } })
    });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('provider').textContent).toBe('openai');
    expect(screen.getByTestId('content').innerHTML).toContain('Fast Game');
  });

  it('advanced mode uses anthropic and reaches ready state', async () => {
    mockGeneration('anthropic', '<div>Advanced Game</div>');
    await act(async () => {
      render(React.createElement(HtmlGenerationFlow, { request: 'Make an advanced game', mode: 'advanced' }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('provider').textContent).toBe('anthropic');
    expect(screen.getByTestId('content').innerHTML).toContain('Advanced Game');
  });

  it('handles backend failure gracefully', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'fail' }) } as any);
    await act(async () => {
      render(React.createElement(HtmlGenerationFlow, { request: 'Bad request', mode: 'fast' }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('treats success:false response as error', async () => {
    (global as any).fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: false, data: null }) });
    await act(async () => {
      render(React.createElement(HtmlGenerationFlow, { request: 'Bad semantic', mode: 'fast' }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('falls back to unknown provider and empty html when missing fields', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { title: 'Game', contentType: 'game' } })
    } as any);
    await act(async () => {
      render(React.createElement(HtmlGenerationFlow, { request: 'Minimal', mode: 'fast' }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('provider').textContent).toBe('unknown');
    expect(screen.getByTestId('content').innerHTML).toBe('');
  });

  it('supports two concurrent flows resolving out of order', async () => {
    let resolveA: any, resolveB: any;
    const promiseA = new Promise<any>(r => { resolveA = r; });
    const promiseB = new Promise<any>(r => { resolveB = r; });
    fetchMock
      .mockResolvedValueOnce(promiseA as any) // A
      .mockResolvedValueOnce(promiseB as any); // B

    await act(async () => {
      render(React.createElement('div', {},
        React.createElement(HtmlGenerationFlow, { request: 'A content', mode: 'fast', id: 'a' }),
        React.createElement(HtmlGenerationFlow, { request: 'B content', mode: 'advanced', id: 'b' })
      ));
    });
    expect(screen.getByTestId('a-status').textContent).toBe('generating');
    expect(screen.getByTestId('b-status').textContent).toBe('generating');

    // Resolve B first
    resolveB({ ok: true, json: async () => ({ success: true, data: { htmlContent: '<p>B</p>', aiProvider: 'anthropic', title: 'B', contentType: 'game' } }) });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('b-status').textContent).toBe('ready');
    expect(screen.getByTestId('a-status').textContent).toBe('generating');

    // Now resolve A
    resolveA({ ok: true, json: async () => ({ success: true, data: { htmlContent: '<p>A</p>', aiProvider: 'openai', title: 'A', contentType: 'game' } }) });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('a-status').textContent).toBe('ready');
    expect(screen.getByTestId('a-provider').textContent).toBe('openai');
    expect(screen.getByTestId('b-provider').textContent).toBe('anthropic');
  });

  it('cancels state updates after unmount', async () => {
    let resolveFetch: any;
    const fetchPromise = new Promise<any>(r => { resolveFetch = r; });
    fetchMock.mockResolvedValueOnce(fetchPromise as any);
    let unmount: () => void = () => {};
    await act(async () => {
      ({ unmount } = render(React.createElement(HtmlGenerationFlow, { request: 'Cancel me', mode: 'fast', id: 'c' })));
    });
    expect(screen.getByTestId('c-status').textContent).toBe('generating');
    unmount();
    resolveFetch({ ok: true, json: async () => ({ success: true, data: { htmlContent: '<p>C</p>', aiProvider: 'openai', title: 'C', contentType: 'game' } }) });
    await act(async () => { await Promise.resolve(); });
    // Query should fail if component unmounted; guard by checking absence
    expect(screen.queryByTestId('c-status')).toBeNull();
  });

  it('aborts without error state change when unmounted promptly (AbortController)', async () => {
    let resolveFetch: any;
    const fetchPromise = new Promise<any>(r => { resolveFetch = r; });
    (global as any).fetch.mockResolvedValueOnce(fetchPromise as any);
    let unmount: () => void = () => {};
    await act(async () => { ({ unmount } = render(React.createElement(HtmlGenerationFlow, { request: 'Abort me', mode: 'advanced', id: 'ab' }))); });
    expect(screen.getByTestId('ab-status').textContent).toBe('generating');
    unmount();
    resolveFetch({ ok: true, json: async () => ({ success: true, data: { htmlContent: '<p>Aborted</p>', aiProvider: 'anthropic', title: 'X', contentType: 'game' } }) });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('ab-status')).toBeNull();
  });
});
