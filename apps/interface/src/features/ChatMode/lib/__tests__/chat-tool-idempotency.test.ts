/**
 * @jest-environment jsdom
 */

import {
  buildChatToolIdempotencyKey,
  runIdempotentChatTool,
} from '../chat-tool-idempotency';

describe('chat tool idempotency', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('builds the same key for semantically identical args', () => {
    const first = buildChatToolIdempotencyKey({
      userId: 'user-1',
      sessionId: 'session-1',
      turnKey: 'turn-1',
      toolName: 'bot_create_note',
      args: { title: 'A', content: 'B' },
    });
    const second = buildChatToolIdempotencyKey({
      userId: 'user-1',
      sessionId: 'session-1',
      turnKey: 'turn-1',
      toolName: 'bot_create_note',
      args: { content: 'B', title: 'A' },
    });

    expect(first).toBe(second);
  });

  it('returns the completed result without executing the same tool again', async () => {
    const runner = jest.fn()
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('created again');

    const first = await runIdempotentChatTool('same-tool-call', runner);
    const second = await runIdempotentChatTool('same-tool-call', runner);

    expect(first).toBe('created');
    expect(second).toBe('created');
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
