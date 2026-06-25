describe('/api/recovery/chat', () => {
  it('is disabled and does not parse proxy messages', async () => {
    const route = await import('../route');
    const request = {
      json: jest.fn(async () => {
        throw new Error('body should not be parsed');
      }),
    };

    const response = await route.POST(request as any);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ error: 'recovery_chat_disabled' });
    expect(request.json).not.toHaveBeenCalled();
  });
});
