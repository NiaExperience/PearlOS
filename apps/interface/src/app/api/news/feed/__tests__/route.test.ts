describe('/api/news/feed', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.PEARLOS_NEWS_CUSTOM_FEEDS_ENABLED;
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('blocks ad hoc single feed fetching by default', async () => {
    const route = await import('../route');
    const request = {
      nextUrl: new URL('https://app.example.test/api/news/feed?url=http://127.0.0.1:4444/health'),
    };

    const response = await route.GET(request as any);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'custom_news_feed_disabled' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks ad hoc multi-feed fetching by default', async () => {
    const route = await import('../route');
    const request = {
      nextUrl: new URL('https://app.example.test/api/news/feed?urls=http://127.0.0.1:4444/health'),
    };

    const response = await route.GET(request as any);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'custom_news_feed_disabled' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
