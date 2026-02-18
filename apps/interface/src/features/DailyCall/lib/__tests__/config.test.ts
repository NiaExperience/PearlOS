describe('getDailyRoomUrl (development)', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  const restoreEnv = () => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
  };

  beforeEach(() => {
    jest.resetModules();
    restoreEnv();
    global.fetch = originalFetch;
    jest.dontMock('os');
  });

  afterAll(() => {
    restoreEnv();
    global.fetch = originalFetch;
  });

  const mockHostname = (value: string) => {
    jest.doMock('os', () => ({
      __esModule: true,
      default: { hostname: () => value },
      hostname: () => value,
    }));
  };

  const setDevEnv = (apiKey?: string) => {
    const nextEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'development',
    };

    delete nextEnv.NEXT_PUBLIC_DAILY_ROOM_URL;
    delete nextEnv.DAILY_ROOM_URL;
    delete nextEnv.DAILYCALL_ROOM_URL;

    if (apiKey === undefined) {
      delete nextEnv.DAILY_API_KEY;
    } else {
      nextEnv.DAILY_API_KEY = apiKey;
    }

    process.env = nextEnv;
  };

  it('reuses the dev room when Daily reports it already exists', async () => {
    setDevEnv('test-key');
    mockHostname('local-box');

    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://old-room.example' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    const { getDailyRoomUrl } = await import('../config');

    const roomUrl = await getDailyRoomUrl();
    expect(roomUrl).toBe('https://old-room.example');

    const checkCall = fetchMock.mock.calls[0];
    expect(checkCall[0]).toBe('https://api.daily.co/v1/rooms/dev-local-box-dailycall');
    expect((checkCall[1] as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
    });

    const updateCall = fetchMock.mock.calls[1];
    expect(updateCall[0]).toBe('https://api.daily.co/v1/rooms/dev-local-box-dailycall');
    expect((updateCall[1] as RequestInit | undefined)?.method).toBe('POST');
    expect(JSON.parse((updateCall[1] as RequestInit | undefined)?.body as string)).toMatchObject({
      privacy: 'public',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('creates the dev room when Daily reports it is missing', async () => {
    setDevEnv('test-key');
    mockHostname('local-box');

    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://new-room.example' }),
      });

    global.fetch = fetchMock as unknown as typeof fetch;

  const { getDailyRoomUrl } = await import('../config');
    const roomUrl = await getDailyRoomUrl();

    expect(roomUrl).toBe('https://new-room.example');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.daily.co/v1/rooms');
  });

  it('returns an empty string when the Daily API key is missing', async () => {
    setDevEnv(undefined);
    mockHostname('local-box');

    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

  const { getDailyRoomUrl } = await import('../config');
    const roomUrl = await getDailyRoomUrl();

    expect(roomUrl).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
