/**
 * @jest-environment jsdom
 */

import {
  executeChatTool,
  getLastChatCanvasOpenTs,
  handleAssistantCanvasMarkup,
  handleLocalCanvasFollowupPrompt,
  preserveVisualSearchIntent,
  rescueMissingVisualCanvas,
  shouldUseVisualCanvasFastPath,
} from '../chat-tool-handlers';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe('chat tool handlers', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
    delete (window as typeof window & { __pearlLastWonderCanvasOpen?: unknown }).__pearlLastWonderCanvasOpen;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates web chat notes in the Pearl assistant notes scope and replays the open event', async () => {
    jest.useFakeTimers();
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const noteEvents: CustomEvent[] = [];
    const onNoteOpen = ((event: CustomEvent) => {
      noteEvents.push(event);
    }) as EventListener;
    window.addEventListener('nia:note.open', onNoteOpen);

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method || 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === '/api/notes/files?agent=pearlos' && init?.method === 'POST') {
        return jsonResponse({ _id: 'note-a', title: 'Welcome', content: 'First note' });
      }
      if (url === '/api/userProfile' && !init) {
        return jsonResponse({
          items: [{
            _id: 'profile-a',
            onboardingState: { requiredActions: { profileUpdated: true } },
          }],
        });
      }
      if (url === '/api/userProfile' && init?.method === 'PATCH') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_create_note', {
      title: 'Welcome',
      content: 'First note',
    });

    expect(result).toBe('Note created: Welcome');
    expect(calls[0]).toMatchObject({
      url: '/api/notes/files?agent=pearlos',
      method: 'POST',
      body: { title: 'Welcome', content: 'First note' },
    });
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      onboardingState: {
        requiredActions: { profileUpdated: true, welcomeNoteCreated: true },
        promptFeatureKey: 'onboarding',
      },
    });

    expect(noteEvents).toHaveLength(0);
    jest.advanceTimersByTime(150);
    expect(noteEvents).toHaveLength(1);
    expect(noteEvents[0].detail.payload.note).toMatchObject({ _id: 'note-a', title: 'Welcome' });
    jest.advanceTimersByTime(450);
    expect(noteEvents).toHaveLength(2);

    window.removeEventListener('nia:note.open', onNoteOpen);
  });

  it('opens and updates web chat notes through the Pearl assistant notes scope', async () => {
    jest.useFakeTimers();
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const noteEvents: CustomEvent[] = [];
    const onNoteOpen = ((event: CustomEvent) => {
      noteEvents.push(event);
    }) as EventListener;
    window.addEventListener('nia:note.open', onNoteOpen);

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method || 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === '/api/notes/files?agent=pearlos&title=Daily+plan') {
        return jsonResponse([{ _id: 'note-b', title: 'Daily plan', content: 'Original' }]);
      }
      if (url === '/api/notes/files?agent=pearlos' && init?.method === 'PATCH') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({}, false, 404);
    });

    const openResult = await executeChatTool('bot_open_note', { title: 'Daily plan' });
    const updateResult = await executeChatTool('bot_update_note', {
      note_id: 'note-b',
      content: 'Updated',
    });

    expect(openResult).toBe('Opened note: Daily plan');
    expect(updateResult).toBe('Note updated: note-b');
    expect(calls[0]).toMatchObject({
      url: '/api/notes/files?agent=pearlos&title=Daily+plan',
      method: 'GET',
    });
    expect(calls[1]).toMatchObject({
      url: '/api/notes/files?agent=pearlos',
      method: 'PATCH',
      body: { id: 'note-b', content: 'Updated' },
    });

    jest.advanceTimersByTime(600);
    expect(noteEvents).toHaveLength(2);
    expect(noteEvents[0].detail.payload.note).toMatchObject({ _id: 'note-b', title: 'Daily plan' });

    window.removeEventListener('nia:note.open', onNoteOpen);
  });

  it('records onboarding progress through the user profile API', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/userProfile' && !init) {
        return jsonResponse({
          items: [{
            _id: 'profile-a',
            onboardingState: { completedBeats: ['beat_1'], requiredActions: { profileUpdated: true } },
          }],
        });
      }
      if (url === '/api/userProfile' && init?.method === 'PATCH') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_onboarding_progress', {
      currentBeat: 2,
      completedBeat: 'beat_2',
      action: 'welcomeNoteCreated',
    });

    expect(result).toBe('Onboarding progress recorded.');
    const patch = calls.find((call) => call.body?.onboardingState);
    expect(patch?.body?.id).toBe('profile-a');
    expect(patch?.body?.onboardingState).toMatchObject({
      currentBeat: 2,
      completedBeats: ['beat_1', 'beat_2'],
      requiredActions: { profileUpdated: true, welcomeNoteCreated: true },
      promptFeatureKey: 'onboarding',
    });
  });

  it('blocks web chat onboarding completion when required actions are missing', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/userProfile' && !init) {
        return jsonResponse({
          items: [{
            _id: 'profile-a',
            onboardingComplete: false,
            onboardingState: { requiredActions: { profileUpdated: true } },
          }],
        });
      }
      throw new Error('PATCH should not be called before requirements are complete');
    });

    const result = await executeChatTool('bot_onboarding_complete', { reason: 'completed' });

    expect(result).toContain('Missing required actions: welcomeNoteCreated');
  });

  it('allows explicit web chat onboarding skip and emits completion event', async () => {
    const patches: Record<string, unknown>[] = [];
    const events: CustomEvent[] = [];
    window.addEventListener('nia:onboarding.complete', ((event: CustomEvent) => {
      events.push(event);
    }) as EventListener);

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/userProfile' && !init) {
        return jsonResponse({
          items: [{ _id: 'profile-a', onboardingComplete: false, onboardingState: {} }],
        });
      }
      if (String(input) === '/api/userProfile' && init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return jsonResponse({ success: true });
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_onboarding_complete', { reason: 'skip' });

    expect(result).toBe('Onboarding marked as complete.');
    expect(patches[0]).toMatchObject({
      id: 'profile-a',
      onboardingComplete: true,
      onboardingState: {
        completedBeats: ['complete'],
        source: 'text',
        promptFeatureKey: 'onboarding',
      },
    });
    expect(events).toHaveLength(1);
  });

  it('summarizes current-news search results without raw citations or canvas process chatter', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'Iran Update, June 5, 2026',
        snippet: 'ISW-CTP previously assessed that Iran could condition negotiations on additional US concessions.[21] Gharibabadi told Iranian media on June 4 that Iran still seeks the immediate removal of sanctions.',
        source: 'ISW',
        url: 'https://example.test/iran-1',
      },
      {
        title: 'IRGC outlets discuss draft memorandum',
        snippet: 'Islamic Revolutionary Guards Corps-affiliated media outlets reported on June 2 that Iran has not sent a response to US President Donald Trump amendments to the draft US-Iran memorandum of understanding and that Iran and the United States have n...',
        source: 'Regional Monitor',
        url: 'https://example.test/iran-2',
      },
      {
        title: 'Strait shipping authority posts fresh vessel data',
        snippet: 'A still photo from a video released by U.S. The Persian Gulf Strait Authority continued to post data on June 3 about ships requesting Iranian permission to pass through the strait.',
        source: 'Maritime Desk',
        url: 'https://example.test/iran-3',
      },
    ];
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: "what's the latest in Iran?", results } });
        }
        if (body.tool_name === 'bot_web_fetch') {
          return jsonResponse({ result: { success: true, content: 'Negotiations, sanctions, and strait shipping risks are all moving together.' } });
        }
      }
      if (url === '/api/chat/news-intelligence') {
        return jsonResponse({
          brief: {
            headline: 'Iran pressure is shifting from rhetoric to bargaining leverage',
            bottomLine: 'The core story is bargaining pressure, not a pile of separate headlines.',
            whyItMatters: 'Sanctions, negotiations, and strait signaling are interacting, which raises the cost of misreading the next move.',
            keyDevelopments: ['Iran is tying diplomacy to sanctions relief.', 'IRGC-linked outlets are shaping expectations around the draft memorandum.', 'Shipping signals are being used as leverage.'],
            stakes: ['Negotiating leverage', 'Shipping risk', 'Regional escalation'],
            watchNext: ['Whether Iran sends a formal response to the draft.'],
            tensions: [{ label: 'Diplomacy', text: 'Public posture and private bargaining are pulling in different directions.' }],
            sourceNames: ['ISW', 'Regional Monitor', 'Maritime Desk'],
          },
        });
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', { query: "what's the latest in Iran?" });

    expect(result).toContain('The core story is bargaining pressure');
    expect(result).toContain('Sanctions, negotiations, and strait signaling');
    expect(result).not.toMatch(/\[\d+\]/);
    expect(result).not.toContain('infographic');
    expect(result).not.toContain('canvas');
    expect(result).not.toContain('Sources sampled');
    expect(result).not.toMatch(/\bDone\.?$/);
    expect(result.length).toBeGreaterThan(120);
    expect(result).not.toMatch(/\bn\.\.\./);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.html).toContain('intelligence brief');
  });

  it('turns weak current-search snippets into a source-backed chat brief and opens one canvas', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'Upcoming Apple products 2026: Every new iPhone, Mac, iPad & Watch coming | Macworld',
        snippet: 'Upcoming Apple products 2026: Every new iPhone, Mac, iPad & Watch coming | Macworld English US Edition Edition English UK English US Mac...',
        source: 'Macworld',
        url: 'https://example.test/apple-products',
      },
      {
        title: 'Latest News - Apple Developer',
        snippet: 'Latest News - Apple Developer View in English Apple Developer Get Started Explore Get Started Overview Learn Apple Developer Program Stay Updated Latest News Hello Developer Platforms Explore...',
        source: 'Apple Developer',
        url: 'https://example.test/apple-developer',
      },
      {
        title: 'Apple kicks off Worldwide Developers Conference on June 8 - Apple',
        snippet: 'Apple kicks off Worldwide Developers Conference on June 8 - Apple Apple Store Mac iPad iPhone Watch Vision AirPods TV & Home Entertainment Accessories Support...',
        source: 'Apple',
        url: 'https://example.test/apple-wwdc',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'latest Apple news', results } });
        }
        if (body.tool_name === 'bot_web_fetch') {
          return jsonResponse({ result: { success: true, content: 'Apple is preparing WWDC developer sessions as attention turns to Apple Intelligence, Siri, iPhone, Mac, iPad, and Watch platform updates.' } });
        }
      }
      if (url === '/api/chat/news-intelligence') {
        return jsonResponse({}, false, 500);
      }
      return jsonResponse({}, false, 404);
    });

    const first = await executeChatTool('bot_web_search', { query: 'latest Apple news' });
    const second = await executeChatTool('bot_web_search', { query: 'latest Apple news' });

    expect(first).toContain('Apple is preparing WWDC developer sessions');
    expect(first).toContain('Apple Intelligence');
    expect(first).not.toContain('Apple is trying to focus developers and customers');
    expect(first).not.toContain('English US Edition');
    expect(first).not.toContain('Get Started Explore');
    expect(first).not.toContain('Sources sampled');
    expect(first).not.toBe('Done.');
    expect(first.length).toBeGreaterThan(120);
    expect(second).toContain('Apple is preparing WWDC developer sessions');
    expect(second).not.toContain('Apple is trying to focus developers and customers');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.html).toContain('intelligence brief');
  });

  it('keeps generic search fallback answer-style and filters browser-check pages', async () => {
    const results = [
      {
        title: 'Checking your browser before accessing pmc.ncbi.nlm.nih.gov',
        snippet: 'Just a moment. Verifying you are human. Cloudflare Ray ID 123.',
        source: 'pmc.ncbi.nlm.nih.gov',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/example',
      },
      {
        title: 'Spirulina: nutrition and clinical uses',
        snippet: 'Spirulina is a blue-green algae used as a supplement. It contains protein, iron, B vitamins, and antioxidant pigments.',
        source: 'Nutrition Review',
        url: 'https://example.test/spirulina',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'what is spirulina ingredient benefits uses', results } });
        }
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', { query: 'what is spirulina ingredient benefits uses' });

    expect(result).toContain('spirulina');
    expect(result).toContain('blue-green algae');
    expect(result).not.toContain('Sources sampled');
    expect(result).not.toMatch(/Checking your browser|Cloudflare|Verifying you are human/i);
    expect(result).not.toBe('Done.');
  });

  it('opens a ranked-list canvas for best-selling style searches without source-dump phrasing', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'List of best-selling books - Wikipedia',
        snippet: 'A Tale of Two Cities by Charles Dickens is often cited above 200 million copies sold. The Little Prince and The Lord of the Rings are also listed among the highest-selling fiction works.',
        source: 'Wikipedia',
        url: 'https://example.test/books',
      },
      {
        title: 'Best selling novels of the 20th century',
        snippet: 'Published estimates vary because some rankings count individual novels and others count series totals, tie-in editions, or publisher shipments.',
        source: 'Book Sales Archive',
        url: 'https://example.test/novels',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'best selling novels of the 20th century', results } });
        }
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', { query: 'best selling novels of the 20th century' });

    expect(result).toContain('ranked view');
    expect(result).toContain('not a clean official scoreboard');
    expect(result).not.toContain('The clearest signal came from');
    expect(result).not.toContain('Sources sampled');
    expect(result).not.toContain('Wikipedia:');
    expect(result).not.toMatch(/^best selling novels of the 20th century:/i);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toContain('Ranked List');
    expect(sceneEvents[0].detail.payload.html).toContain('ranked estimate');
    expect(sceneEvents[0].detail.payload.html).toContain('A Tale of Two Cities');
  });

  it('cleans ranked visual prompt suffixes and uses movie-specific caveats', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'Highest-grossing films before 2000',
        snippet: 'Titanic, Star Wars, Jurassic Park, and E.T. are commonly listed among the biggest box-office films before 2000.',
        source: 'Box Office Archive',
        url: 'https://example.test/movies',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'highest-grossing movies before 2000 and show the ranking visually', results } });
        }
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', {
      query: 'show me the highest-grossing movies before 2000 and show the ranking visually.',
    });

    expect(result).toContain('ranked view for highest-grossing movies before 2000');
    expect(result).not.toContain('before 2000 and on the canvas');
    expect(result).toContain('box-office rankings');
    expect(result).not.toContain('live ratings');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.html).toContain('box-office rankings');
  });

  it('treats generic visual search results as companion-ready canvas replies', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'Console wars overview',
        snippet: 'The console wars moved through Atari and Intellivision, Nintendo and Sega, Sony entering with PlayStation, and the modern Xbox, Switch, and PS5 market.',
        source: 'Games History',
        url: 'https://example.test/console-wars',
      },
      {
        title: 'Video game console generation timeline',
        snippet: 'Major turning points include the 1983 crash, the NES recovery, Sega Genesis marketing, PlayStation CD adoption, Xbox Live, and hybrid handheld-console play.',
        source: 'Timeline Archive',
        url: 'https://example.test/console-timeline',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'console wars infographic visual phases', results } });
        }
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', { query: 'console wars infographic visual phases' });

    expect(result).toContain('I put');
    expect(result).toContain('The useful read is the structure');
    expect(result).toContain('[[pearl:companion-ready]]');
    expect(result).not.toMatch(/\bLet me\b|\bI need actual\b/i);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toContain('Infographic');
  });

  it('opens a timeline canvas for show-me history searches without a second prompt', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'Netflix company history',
        snippet: 'Netflix began as a DVD-by-mail service in 1997, shifted into streaming in 2007, then expanded into original programming and global distribution.',
        source: 'Company History',
        url: 'https://example.test/netflix-history',
      },
      {
        title: 'Netflix streaming timeline',
        snippet: 'Major milestones include subscriptions, the streaming launch, House of Cards, international expansion, and the later advertising-supported tier.',
        source: 'Media Timeline',
        url: 'https://example.test/netflix-timeline',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'show me the history of Netflix', results } });
        }
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', {
      query: 'show me the history of Netflix',
    });

    expect(result).toContain('timeline');
    expect(result).toContain('[[pearl:companion-ready]]');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toContain('Infographic');
    expect(sceneEvents[0].detail.payload.html).toContain('DVD-by-mail');
  });

  it('does not give commerce caveats for large extinction-event visual comparisons', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'End-Permian extinction',
        snippet: 'The end-Permian extinction is often described as the most severe known mass extinction, with large losses in marine and terrestrial biodiversity.',
        source: 'Geology Archive',
        url: 'https://example.test/permian',
      },
      {
        title: 'Ordovician-Silurian extinction',
        snippet: 'The Ordovician-Silurian extinction involved major marine biodiversity losses and is usually grouped among the largest events in the fossil record.',
        source: 'Paleontology Notes',
        url: 'https://example.test/ordovician',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'comparison board largest extinction events geological time', results } });
        }
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', {
      query: 'create a comparison board of the largest extinction events across geological time',
    });

    expect(result).toContain('comparison board');
    expect(result).toContain('The useful read is the structure');
    expect(result).not.toContain('ranked view');
    expect(result).not.toMatch(/\b(?:sales|shipments|downloads|active players|cultural footprint)\b/i);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toContain('Infographic');
    expect(sceneEvents[0].detail.payload.html).not.toContain('Ranked lists');
  });

  it('keeps visual history-through-today prompts off the slow news-snippet route', async () => {
    const sceneEvents: CustomEvent[] = [];
    const toolNames: string[] = [];
    const gatewayParams: Record<string, unknown>[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'History of the electric vehicle',
        snippet: 'Electric vehicles moved from early experiments, to a late nineteenth-century boom, to gasoline-era decline, to lithium-ion and mass-market adoption.',
        source: 'Transport History',
        url: 'https://example.test/ev-history',
      },
      {
        title: 'Electric car timeline',
        snippet: 'Key phases include nineteenth-century prototypes, urban taxi fleets, the internal-combustion takeover, hybrids, Tesla, and broad automaker electrification.',
        source: 'Energy Archive',
        url: 'https://example.test/ev-timeline',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        toolNames.push(body.tool_name);
        gatewayParams.push(body.params);
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'make a chart of the development of electric vehicles from early experiments to today', results } });
        }
        throw new Error(`unexpected tool call: ${body.tool_name}`);
      }
      if (url === '/api/chat/news-intelligence') {
        throw new Error('visual history prompt should not call news intelligence');
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', {
      query: 'make a chart of the development of electric vehicles from early experiments to today',
    });

    expect(result).toContain('canvas');
    expect(result).toContain('chart');
    expect(result).toContain('[[pearl:companion-ready]]');
    expect(result).not.toContain('Wikipedia');
    expect(result).not.toContain('Watch next');
    expect(toolNames).toEqual(['bot_web_search']);
    expect(gatewayParams[0]).not.toHaveProperty('__client_timeout_ms');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toContain('Infographic');
  });

  it('keeps conflict-risk visual breakdown prompts on the fast canvas route without explicit live-news wording', async () => {
    const sceneEvents: CustomEvent[] = [];
    const toolNames: string[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'Strategic petroleum reserve overview',
        snippet: 'The reserve is an emergency crude oil stockpile used to cushion supply shocks and market panic during disruption risk.',
        source: 'Energy Primer',
        url: 'https://example.test/spr',
      },
      {
        title: 'Oil chokepoints and market risk',
        snippet: 'Middle East conflict risk can affect shipping lanes, insurance costs, and crude-price expectations before physical shortages appear.',
        source: 'Market Risk Notes',
        url: 'https://example.test/chokepoints',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        toolNames.push(body.tool_name);
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'strategic petroleum reserve middle east conflict risk visual breakdown', results } });
        }
        throw new Error(`unexpected tool call: ${body.tool_name}`);
      }
      if (url === '/api/chat/news-intelligence') {
        throw new Error('visual conflict-risk prompt should not call news intelligence without a live-news cue');
      }
      return jsonResponse({}, false, 404);
    });

    const result = await executeChatTool('bot_web_search', {
      query: 'sketch a visual breakdown of the strategic petroleum reserve and why it matters during Middle East conflict risk',
    });

    expect(result).toContain('visual breakdown');
    expect(result).toContain('The useful read is the structure');
    expect(result).toContain('[[pearl:companion-ready]]');
    expect(result).not.toContain('Watch next');
    expect(toolNames).toEqual(['bot_web_search']);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toContain('Infographic');
  });

  it('renders React-style WonderCanvas markup and removes it from chat text', () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const result = handleAssistantCanvasMarkup([
      '<WonderCanvas title="Electric Vehicle Journey" template="timeline" data={{ sections: [',
      '{ id: "early", label: "Early Experiments", period: "1830s-1890s", items: [',
      '{ year: "1832", title: "First Crude EV", detail: "Robert Anderson builds a non-rechargeable electric carriage." },',
      '{ year: "1859", title: "Rechargeable Battery", detail: "Gaston Plante invents the lead-acid battery." }',
      '] },',
      '{ id: "modern", label: "Modern Breakthrough", period: "2000s-2010s", items: [',
      '{ year: "2008", title: "Tesla Roadster", detail: "Lithium-ion makes long-range performance credible." }',
      '] }',
      '], conclusion: "The long arc moves from experimental carriages to mass-market battery platforms." }} />',
      '',
      'The useful arc is early promise, a long gasoline detour, then lithium-ion scale.',
    ].join('\n'));

    expect(result.opened).toBe(true);
    expect(result.text).toContain('useful arc');
    expect(result.text).not.toContain('WonderCanvas');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toBe('Electric Vehicle Journey');
    expect(sceneEvents[0].detail.payload.html).toContain('1832: First Crude EV');
    expect(sceneEvents[0].detail.payload.html).toContain('2008: Tesla Roadster');
  });

  it('does not expose raw browser challenge content from fetches', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      result: {
        success: true,
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/example',
        content: 'Checking your browser before accessing pmc.ncbi.nlm.nih.gov. Just a moment. Verifying you are human.',
      },
    }));

    const result = await executeChatTool('bot_web_fetch', { url: 'https://pmc.ncbi.nlm.nih.gov/articles/example' });

    expect(result).toContain('blocking automated reading');
    expect(result).not.toMatch(/Checking your browser|Verifying you are human/i);
  });

  it('opens a visual canvas for a show-me follow-up using the last answer', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);
    const previousAnswer = [
      'Russia spring-summer offensive has stalled.',
      'Ukraine took back 38 square miles in a single week.',
      'Ukraine 3rd Army Corps established fire control over five cities in occupied Luhansk.',
      'Moscow is leaning on ballistic missiles because the ground advance is not working.',
    ].join('\n');

    const result = await handleLocalCanvasFollowupPrompt('show me', previousAnswer);

    expect(result).toContain('visual breakdown');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.html).toContain('Ukraine took back 38 square miles');
    expect(sceneEvents[0].detail.payload.html).not.toContain('Done.');
  });

  it('does not treat a new show-me topic as a stale canvas follow-up', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);
    const previousAnswer = [
      'I put the visual breakdown on the canvas.',
      'Key points from the last answer.',
      'I put the visual breakdown on the canvas.',
    ].join('\n');

    const result = await handleLocalCanvasFollowupPrompt(
      'show me a timeline of all mass extinction events throughout geological history',
      previousAnswer,
    );

    expect(result).toBeNull();
    expect(sceneEvents).toHaveLength(0);
  });

  it('does not build a follow-up canvas from a canvas acknowledgement only', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const result = await handleLocalCanvasFollowupPrompt(
      'show me',
      'I put the visual breakdown on the canvas.',
    );

    expect(result).toBeNull();
    expect(sceneEvents).toHaveLength(0);
  });

  it('keeps fresh visual requests on the model/tool path instead of using local canned content', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);
    const previousAnswer = 'I put the visual breakdown on the canvas.';
    const topics = ['animal evolution', 'Blockbuster video', 'Persian cinema', 'arcade hardware'];
    const formats = ['timeline', 'infographic', 'visual map', 'chart'];

    for (const [index, topic] of topics.entries()) {
      const result = await handleLocalCanvasFollowupPrompt(
        `show me a ${formats[index]} of ${topic}`,
        previousAnswer,
      );
      expect(result).toBeNull();
    }
    expect(sceneEvents).toHaveLength(0);
  });

  it('preserves visual intent when a model turns a visual request into a plain web search', () => {
    expect(preserveVisualSearchIntent(
      { query: 'space telescope generations history Hubble James Webb discoveries tradeoffs', count: 5 },
      'put together an infographic of space telescope generations and what each unlocked',
    )).toMatchObject({
      query: expect.stringMatching(/infographic visual/i),
      count: 5,
    });

    expect(preserveVisualSearchIntent(
      { query: 'renewable energy storage technologies best use cases tradeoffs comparison 2025' },
      'show me a visual map of renewable energy storage options by best use case',
    )).toMatchObject({
      query: expect.stringMatching(/visual map/i),
    });

    expect(preserveVisualSearchIntent(
      { query: 'best selling novels of the 20th century' },
      'show me the best selling novels of the 20th century',
    )).toMatchObject({
      query: expect.stringMatching(/ranked list visual/i),
    });

    expect(preserveVisualSearchIntent(
      { query: 'best-selling albums of the 1990s certified sales' },
      'pull together the top-selling albums of the 1990s with a useful caveat about methodology',
    )).toMatchObject({
      query: expect.stringMatching(/ranked list visual/i),
    });
  });

  it('treats show-me history prompts as first-response timeline canvas requests', () => {
    expect(shouldUseVisualCanvasFastPath('show me the history of Netflix')).toBe(true);
    expect(shouldUseVisualCanvasFastPath('walk me through the evolution of Netflix streaming')).toBe(true);
    expect(shouldUseVisualCanvasFastPath('show me my chat history')).toBe(false);

    expect(preserveVisualSearchIntent(
      { query: 'history of Netflix' },
      'show me the history of Netflix',
    )).toMatchObject({
      query: expect.stringMatching(/history of Netflix timeline visual/i),
    });
  });

  it('opens one current-news canvas only when the user explicitly asks for an infographic', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const results = [
      {
        title: 'Apple kicks off Worldwide Developers Conference on June 8 - Apple',
        snippet: 'Apple is preparing WWDC developer sessions as attention turns to Apple Intelligence, Siri, iPhone, Mac, iPad, and Watch platform updates.',
        source: 'Apple',
        url: 'https://example.test/apple-wwdc',
      },
    ];

    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tools/invoke') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.tool_name === 'bot_web_search') {
          return jsonResponse({ result: { query: 'show an infographic for latest Apple news', results } });
        }
        if (body.tool_name === 'bot_web_fetch') {
          return jsonResponse({ result: { success: true, content: results[0].snippet } });
        }
      }
      if (url === '/api/chat/news-intelligence') {
        return jsonResponse({}, false, 500);
      }
      return jsonResponse({}, false, 404);
    });

    const first = await executeChatTool('bot_web_search', { query: 'show an infographic for latest Apple news' });
    const second = await executeChatTool('bot_web_search', { query: 'show an infographic for latest Apple news' });

    expect(first).toContain('Apple is preparing WWDC developer sessions');
    expect(first).not.toContain('Apple is trying to focus developers and customers');
    expect(second).toContain('Apple is preparing WWDC developer sessions');
    expect(second).not.toContain('Apple is trying to focus developers and customers');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.html).toContain('intelligence brief');
    expect(sceneEvents[0].detail.payload.html).not.toContain('sources folded into brief');
  });

  it('delegates template rendering to the gateway and keeps the reply terse', async () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ success: true }));

    const result = await executeChatTool('bot_wonder_canvas_template', {
      template: 'fact_card',
      data: {
        title: 'Iran brief',
        items: ['Negotiations remain active.', 'Shipping signals are being watched.'],
      },
    });

    expect(result).toContain('Wonder Canvas opened: Iran brief.');
    expect(result).not.toBe('Done.');
    expect(result).not.toContain('Sources sampled');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.html).toContain('Iran brief');
  });

  it('renders generic assistant canvas markup as Wonder Canvas instead of leaking raw tags', () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);

    const result = handleAssistantCanvasMarkup([
      '<canvas type="visual-map" layout="milestones">',
      '{ "elements": [',
      '{ "type": "header", "content": "Invented Archive Map" },',
      '{ "type": "label", "content": "1901" },',
      '{ "type": "card", "content": "The first archive opens to the public." },',
      '{ "type": "label", "content": "1950" },',
      '{ "type": "card", "content": "The archive adds machine-readable indexes." }',
      '] }',
      '</canvas>',
      '',
      'The important part is the shift from scarce access to searchable public records.',
    ].join('\n'));

    expect(result.opened).toBe(true);
    expect(result.text).toContain('shift from scarce access');
    expect(result.text).not.toContain('<canvas');
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toBe('Invented Archive Map');
    expect(sceneEvents[0].detail.payload.html).toContain('1901');
    expect(sceneEvents[0].detail.payload.html).toContain('machine-readable indexes');
  });

  it('rescues a structured visual answer into Wonder Canvas when no canvas fired', () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);
    const baseline = getLastChatCanvasOpenTs();

    const opened = rescueMissingVisualCanvas(
      'show me a comparison board of arcade hardware and cabinets with dates where they matter',
      [
        "Here's how arcade hardware and cabinets evolved, generation by generation.",
        '',
        '## Arcade Hardware & Cabinet Evolution',
        '### Generation 1: The Pioneers (1971-1975)',
        'Cabinet style: Simple upright wooden boxes with small black-and-white CRTs.',
        'Key hardware: Discrete transistor logic, before microprocessors entered cabinets.',
        '### Generation 2: The Microprocessor Era (1976-1979)',
        'Cabinet style: Taller uprights and cocktail tables became common.',
        'Key hardware: MOS 6502, Zilog Z80, and Intel 8080 made games software-driven.',
      ].join('\n'),
      baseline,
    );

    expect(opened).toBe(true);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.meta.scenario).toBe('assistant-visual-rescue');
    expect(sceneEvents[0].detail.payload.title).toContain('comparison board of arcade hardware');
    expect(sceneEvents[0].detail.payload.html).toContain('Generation 1');
    expect(sceneEvents[0].detail.payload.html).toContain('MOS 6502');
    expect(getLastChatCanvasOpenTs()).toBeGreaterThan(baseline);
  });

  it('does not rescue a visual answer when a canvas already opened during the turn', () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);
    const baseline = getLastChatCanvasOpenTs();

    handleAssistantCanvasMarkup('<canvas type="visual-map">{"title":"Already Open","items":["One","Two"]}</canvas>');
    const opened = rescueMissingVisualCanvas(
      'show me a timeline of navigation instruments',
      'A timeline answer with several structured periods and dates.',
      baseline,
    );

    expect(opened).toBe(false);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toBe('Already Open');
  });

  it('rescues canvas acknowledgement text when no visual event actually fired', () => {
    const sceneEvents: CustomEvent[] = [];
    window.addEventListener('nia:wonder.scene', ((event: CustomEvent) => {
      sceneEvents.push(event);
    }) as EventListener);
    const baseline = getLastChatCanvasOpenTs();

    const opened = rescueMissingVisualCanvas(
      'make the most widely read fantasy novels of the 20th century with a short takeaway in chat',
      'I put the ranked view for widely read fantasy novels of the 20th century on the canvas.',
      baseline,
    );

    expect(opened).toBe(true);
    expect(sceneEvents).toHaveLength(1);
    expect(sceneEvents[0].detail.payload.title).toContain('most widely read fantasy novels');
    expect(sceneEvents[0].detail.payload.html).toContain('Ranking frame');
    expect(sceneEvents[0].detail.payload.html).toContain('Method caveat');
  });

  it('includes task result destinations in web chat task status summaries', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('status=completed')) {
        return jsonResponse({
          tasks: [
            {
              title: 'Build Lagoon Gems',
              status: 'completed',
              result: 'Built the site.',
              artifactUrl: '/api/tasks/artifact/task-1/index.html',
            },
          ],
        });
      }
      return jsonResponse({ tasks: [] });
    });

    const result = await executeChatTool('bot_list_tasks', { query: 'Lagoon Gems' });

    expect(result).toContain('Recently completed');
    expect(result).toContain('Build Lagoon Gems');
    expect(result).toContain('Result: artifact /api/tasks/artifact/task-1/index.html.');
  });

  it('does not describe a completed task match as only not actively running', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('status=completed')) {
        return jsonResponse({
          tasks: [
            {
              title: 'Image generation model plan',
              status: 'completed',
              result: 'Use Flux for the first implementation, then compare hosted frontier APIs before production rollout.',
            },
          ],
        });
      }
      return jsonResponse({ tasks: [] });
    });

    const result = await executeChatTool('bot_list_tasks', { query: 'image generation' });

    expect(result).toContain('The matching task is finished.');
    expect(result).toContain('Use Flux for the first implementation');
    expect(result).not.toContain('I do not see a matching task still actively running.');
  });
});
