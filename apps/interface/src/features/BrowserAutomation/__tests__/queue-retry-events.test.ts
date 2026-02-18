/**
 * @jest-environment jsdom
 */
import { dispatchBrowserEvent, BrowserEventName, BrowserEventDetailMap } from '../lib/events';

// Simulated queue processor focusing on event dispatch + retry/failure logic
// Mirrors RealBrowserView queue loop semantics (cooldown, retries, success/failure events)

type Kind = 'navigate' | 'perform';
interface QueuedItem { id: string; kind: Kind; payload: any; createdAt: number; retries: number; }

const ACTION_COOLDOWN_MS = 10; // fast for tests
const MAX_RETRIES = 2; // align with RealBrowserView

function createTestProcessor(overrides?: {
  navigateImpl?: (url: string, attempt: number) => Promise<void>;
  performImpl?: (action: any, attempt: number) => Promise<void>;
}) {
  const queue: QueuedItem[] = [];
  let lastActionTime = -ACTION_COOLDOWN_MS; // allow immediate first action
  const attempts: Record<string, number> = {};

  const internalNavigate = async (url: string, id: string) => {
    attempts[id] = (attempts[id] || 0) + 1;
    if (overrides?.navigateImpl) return overrides.navigateImpl(url, attempts[id]);
    // default always succeed
    return;
  };
  const internalPerform = async (action: any, id: string) => {
    attempts[id] = (attempts[id] || 0) + 1;
    if (overrides?.performImpl) return overrides.performImpl(action, attempts[id]);
    return;
  };

  function enqueueNavigate(id: string, url: string) {
    queue.push({ id, kind: 'navigate', payload: { url }, createdAt: Date.now(), retries: 0 });
    dispatchBrowserEvent('browser.queue.enqueue', { id, kind: 'navigate', size: queue.length });
  }
  function enqueueAction(id: string, actionData: any) {
    queue.push({ id, kind: 'perform', payload: { actionData }, createdAt: Date.now(), retries: 0 });
    dispatchBrowserEvent('browser.queue.enqueue', { id, kind: 'perform', size: queue.length });
    dispatchBrowserEvent('browser.action.request', { action: actionData });
  }

  async function step(now: number) {
    const next = queue[0];
    if (!next) return;
    if (now - lastActionTime < ACTION_COOLDOWN_MS) return;
    queue.shift();
    dispatchBrowserEvent('browser.queue.dequeue', { id: next.id, kind: next.kind });
    lastActionTime = now;
    try {
      if (next.kind === 'navigate') await internalNavigate(next.payload.url, next.id);
      else await internalPerform(next.payload.actionData, next.id);
      dispatchBrowserEvent('browser.action.success', { id: next.id, kind: next.kind });
    } catch (e) {
      if (next.retries < MAX_RETRIES) {
        const retryItem = { ...next, retries: next.retries + 1 };
        queue.push(retryItem);
        dispatchBrowserEvent('browser.action.retry', { id: next.id, attempt: retryItem.retries });
      } else {
        dispatchBrowserEvent('browser.action.failed', { id: next.id, error: String(e) });
      }
    }
  }

  return { enqueueNavigate, enqueueAction, step };
}

function collectEvents() {
  const received: Array<{ name: BrowserEventName; detail: any }> = [];
  const listeners: Array<() => void> = [];
  const names: BrowserEventName[] = [
    'browser.queue.enqueue',
    'browser.queue.dequeue',
    'browser.action.request',
    'browser.action.success',
    'browser.action.retry',
    'browser.action.failed',
    'browser.session.closed',
    'browser.session.close_error'
  ];
  names.forEach(name => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<BrowserEventDetailMap[typeof name]>;
      received.push({ name, detail: ce.detail });
    };
    window.addEventListener(name, handler as EventListener);
    listeners.push(() => window.removeEventListener(name, handler as EventListener));
  });
  return { received, cleanup: () => listeners.forEach(fn => fn()) };
}

// Utility to advance steps until queue drained or max iterations
async function drain(processor: ReturnType<typeof createTestProcessor>, steps: number, advanceMs = 15) {
  for (let i = 0; i < steps; i++) {
    await processor.step(i * advanceMs);
  }
}

describe('browser automation event contract - queue retry/failure', () => {
  it('emits retry then success sequence (single failure then success)', async () => {
    const events = collectEvents();
    const failingOnceId = 'action-fail-once';
    let first = true;
    const processor = createTestProcessor({
      performImpl: async (_a, attempt) => {
        if (first) { first = false; throw new Error('transient'); }
      }
    });

    processor.enqueueNavigate('nav-1', 'https://example.com');
    processor.enqueueAction(failingOnceId, { type: 'click', selector: '#btn' });

    await drain(processor, 10);

    const sequence = events.received.map(e => e.name);
    // Expect enqueue (nav), enqueue (action), action.request, dequeue(nav), success(nav), dequeue(action), retry(action), dequeue(action), success(action)
    expect(sequence).toEqual([
      'browser.queue.enqueue', // nav
      'browser.queue.enqueue', // action
      'browser.action.request',
      'browser.queue.dequeue',
      'browser.action.success',
      'browser.queue.dequeue',
      'browser.action.retry',
      'browser.queue.dequeue',
      'browser.action.success'
    ]);

    // Validate retry detail attempt=1
    const retryEvt = events.received.find(e => e.name === 'browser.action.retry');
    expect(retryEvt?.detail).toMatchObject({ id: failingOnceId, attempt: 1 });

    events.cleanup();
  });

  it('emits failed after exhausting retries', async () => {
    const events = collectEvents();
    const alwaysFailId = 'action-always-fail';
    const processor = createTestProcessor({
      performImpl: async () => { throw new Error('boom'); }
    });

    processor.enqueueAction(alwaysFailId, { type: 'click', selector: '#fail' });

    await drain(processor, 15); // enough cycles for retries + failure

    const retryEvents = events.received.filter(e => e.name === 'browser.action.retry');
    expect(retryEvents).toHaveLength(2); // attempts 1 & 2
    expect(retryEvents[0].detail).toMatchObject({ id: alwaysFailId, attempt: 1 });
    expect(retryEvents[1].detail).toMatchObject({ id: alwaysFailId, attempt: 2 });

    const failedEvent = events.received.find(e => e.name === 'browser.action.failed');
    expect(failedEvent).toBeTruthy();
    expect(failedEvent?.detail).toMatchObject({ id: alwaysFailId });

    // Ensure order ends with failed
    const lastEventName = events.received[events.received.length - 1].name;
    expect(lastEventName).toBe('browser.action.failed');

    events.cleanup();
  });
});
