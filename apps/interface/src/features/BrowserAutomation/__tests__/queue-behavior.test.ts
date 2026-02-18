// Basic queue behavior tests by simulating enqueue and timing logic.
// We isolate a minimal version of the processor to avoid React dependency.

import { v4 as uuid } from 'uuid';

interface QueuedAction { id: string; kind: 'navigate' | 'perform'; payload: any; createdAt: number; retries: number; }

const ACTION_COOLDOWN_MS = 50; // faster for tests

function createProcessor() {
  const queue: QueuedAction[] = [];
  // Initialize so first action is not throttled
  let lastActionTime = -ACTION_COOLDOWN_MS;
  const completed: string[] = [];

  const internalNavigate = async (url: string) => { completed.push(`nav:${url}`); };
  const internalPerform = async (a: any) => { completed.push(`act:${a.type}`); };

  async function step(now: number) {
    const next = queue[0];
    if (!next) return;
    if (now - lastActionTime < ACTION_COOLDOWN_MS) return;
    queue.shift();
    lastActionTime = now;
    if (next.kind === 'navigate') await internalNavigate(next.payload.url);
    else await internalPerform(next.payload.actionData);
  }

  function enqueueNavigate(url: string) {
    queue.push({ id: uuid(), kind: 'navigate', payload: { url }, createdAt: Date.now(), retries: 0 });
  }
  function enqueueAction(actionData: any) {
    queue.push({ id: uuid(), kind: 'perform', payload: { actionData }, createdAt: Date.now(), retries: 0 });
  }

  return { queue, completed, enqueueNavigate, enqueueAction, step };
}

describe('browser action queue', () => {
  it('processes actions with cooldown ordering', async () => {
    const p = createProcessor();
    p.enqueueNavigate('https://cnn.com');
    p.enqueueAction({ type: 'click' });

    // initial step at t=0 processes first
    await p.step(0);
    expect(p.completed).toEqual(['nav:https://cnn.com']);

    // too soon for second
    await p.step(10);
    expect(p.completed).toHaveLength(1);

    // after cooldown
    await p.step(60);
    expect(p.completed).toEqual(['nav:https://cnn.com', 'act:click']);
  });
});
