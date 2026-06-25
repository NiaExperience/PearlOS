/**
 * @jest-environment jsdom
 */

import { executeChatTool } from '../src/features/ChatMode/lib/chat-tool-handlers';
import { routeNiaEvent } from '@interface/features/DailyCall/events/niaEventRouter';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

jest.mock('@interface/features/DailyCall/events/niaEventRouter', () => ({
  NIA_EVENT_NOTE_OPEN: 'nia:note.open',
  NIA_EVENT_NOTE_UPDATED: 'nia:note.updated',
  NIA_EVENT_DESKTOP_MODE_SWITCH: 'nia:desktop.mode.switch',
  NIA_EVENT_LAYOUT_MODE_SWITCH: 'nia:layout.mode.switch',
  NIA_EVENT_ONBOARDING_COMPLETE: 'nia:onboarding.complete',
  routeNiaEvent: jest.fn(),
}));

jest.mock('@interface/features/ManeuverableWindow/lib/windowLifecycleController', () => ({
  requestWindowOpen: jest.fn(),
  requestWindowClose: jest.fn(),
}));

const routeNiaEventMock = routeNiaEvent as jest.MockedFunction<typeof routeNiaEvent>;
const requestWindowOpenMock = requestWindowOpen as jest.MockedFunction<typeof requestWindowOpen>;

describe('chat tool handlers', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    routeNiaEventMock.mockClear();
    requestWindowOpenMock.mockClear();
  });

  it('formats web search results as a natural summary and opens a Wonder Canvas for current news', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        result: {
          success: true,
          query: 'Ukraine war latest news today June 2026',
          results: [
            {
              title: 'Russian Offensive Campaign Assessment',
              url: 'https://understandingwar.org/research/russia-ukraine/example',
              snippet: 'Russian advances have slowed amid Ukrainian counterattacks and mid-range strikes.',
            },
            {
              title: 'Ukraine-Russia war latest',
              url: 'https://www.independent.co.uk/news/world/europe/example.html',
              snippet: 'US House passes bill to aid Ukraine and impose new sanctions on Russia.',
            },
            {
              title: 'Russian Offensive Campaign Assessment, June 2',
              url: 'https://understandingwar.org/research/russia-ukraine/example-2',
              snippet: '<strong>Russian forces conducted another drone and missile strike series against Ukraine.</strong>',
            },
            {
              title: 'At least 22 people killed in Russian attacks',
              url: 'https://www.aljazeera.com/news/example',
              snippet: 'Ukrainian authorities say at least 22 people have been killed and dozens wounded.',
            },
          ],
        },
      }),
    });

    const result = await executeChatTool('bot_web_search', {
      query: 'Ukraine war latest news today June 2026',
      count: 5,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/tools/invoke', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        tool_name: 'bot_web_search',
        params: { query: 'Ukraine war latest news today June 2026', count: 5 },
      }),
    }));
    expect(result).not.toContain('Web search');
    expect(result).not.toContain('<strong>');
    const visibleSections = result
      .split('\n\n')
      .filter(Boolean)
      .filter((section) => section !== '[[pearl:companion-ready]]');
    expect(visibleSections).toHaveLength(4);
    expect(result).toContain('Watch next:');

    expect(requestWindowOpenMock).not.toHaveBeenCalled();
    expect(routeNiaEventMock).toHaveBeenCalledTimes(1);
    const wonderRequest = routeNiaEventMock.mock.calls[0]?.[1] as { title?: string; html?: string };
    expect(routeNiaEventMock.mock.calls[0]?.[0]).toBe('wonder.scene');
    expect(wonderRequest?.title).toContain('Intelligence Brief');
    expect(wonderRequest?.html).toContain('Russian advances have slowed');
    expect(wonderRequest?.html).not.toContain('<strong>Russian forces');
  });

  it('routes Wonder Canvas scene once without rebroadcasting through the gateway', async () => {
    const result = await executeChatTool('bot_wonder_canvas_scene', {
      title: 'Canvas QA',
      html: '<main><h1>Canvas QA</h1></main>',
    });

    expect(result).toContain('Wonder Canvas opened: Canvas QA.');
    expect(result).toContain('Visible canvas text: Canvas QA');
    expect(result).not.toBe('Done.');
    expect(routeNiaEventMock).toHaveBeenCalledTimes(1);
    expect(routeNiaEventMock).toHaveBeenCalledWith('wonder.scene', expect.objectContaining({
      title: 'Canvas QA',
      html: '<main><h1>Canvas QA</h1></main>',
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
