/* eslint-disable @typescript-eslint/no-explicit-any */
import vm from 'vm';

import { describe, expect, it } from '@jest/globals';
import { buildStorageBootstrapSnippet, buildStorageLibraryAppendix, buildStorageLibraryCode } from '@nia/features';

describe('buildStorageLibraryAppendix', () => {
  it('injects tenant and assistant identifiers into the helper', () => {
    const appendix = buildStorageLibraryAppendix({ tenantId: 'tenant-123', assistantName: 'assistant-abc' });
    expect(appendix).toContain('tenant-123');
    expect(appendix).toContain('assistant-abc');
  });

  it('includes the storage helper, guidance sections, and API endpoint', () => {
    const appendix = buildStorageLibraryAppendix();
    expect(appendix).toContain('STORAGE LIBRARY APPENDIX');
    expect(appendix).toContain('class NiaAPI');
    expect(appendix).toContain('/api/applet-api');
    expect(appendix).toContain('BUTTON + INTERACTION REQUIREMENTS');
  });

  it('produces runnable helper code with injected identifiers', async () => {
    const code = buildStorageLibraryCode({ tenantId: 'tenant-xyz', assistantName: 'assistant-xyz' });
    const context: any = { URLSearchParams, fetch: async () => ({ ok: true, json: async () => ({ item: {}, items: [] }) }) };
    vm.createContext(context);
    await vm.runInContext(`${code}; globalThis.NiaAPI = NiaAPI;`, context);
    expect(typeof context.NiaAPI).toBe('function');
    const api = new context.NiaAPI();
    expect(api.tenantId).toBe('tenant-xyz');
    expect(api.assistantName).toBe('assistant-xyz');
  });

  it('bootstrap picks up tenant and assistant from applet config and events', async () => {
    const snippet = buildStorageBootstrapSnippet();

    // Minimal window/event stubs
    // eslint-disable-next-line @typescript-eslint/ban-types
    const listeners: Record<string, Function[]> = {};
    const windowMock: any = {
      api: undefined,
      parent: undefined as any,
      getAppletConfig: () => ({ tenantId: 'tenant-from-getter', assistantName: 'assistant-from-getter' }),
      addEventListener: (type: string, cb: any) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(cb);
      },
      dispatchEvent: (evt: any) => {
        (listeners[evt.type] || []).forEach((cb) => cb(evt));
        return true;
      }
    };
    windowMock.parent = windowMock;

    const context: any = {
      window: windowMock,
      console,
      CustomEvent: class CustomEvent {
        type: string;
        detail: any;
        constructor(type: string, init?: { detail?: any }) {
          this.type = type;
          this.detail = init?.detail;
        }
      }
    };

    vm.createContext(context);

    // The snippet is wrapped in <script> tags; strip them before eval
    const js = snippet.replace(/<\/?script>/g, '');
    await vm.runInContext(js, context);

    expect(windowMock.api).toBeDefined();
    expect(windowMock.api.tenantId).toBe('tenant-from-getter');
    expect(windowMock.api.assistantName).toBe('assistant-from-getter');

    // Simulate late-arriving config event to ensure overrides occur
    windowMock.dispatchEvent(new context.CustomEvent('appletConfigReady', { detail: { tenantId: 'tenant-from-event', assistantName: 'assistant-from-event' } }));
    expect(windowMock.api.tenantId).toBe('tenant-from-event');
    expect(windowMock.api.assistantName).toBe('assistant-from-event');
  });
});
