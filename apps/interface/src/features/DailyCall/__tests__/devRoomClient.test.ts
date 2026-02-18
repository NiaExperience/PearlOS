/* eslint-disable @typescript-eslint/no-explicit-any */
import { requestDevRoomDeletion } from '../lib/devRoomClient';

describe('requestDevRoomDeletion', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('sends DELETE request with provided parameters and returns deletion flag', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true }),
    });

    const deleted = await requestDevRoomDeletion({
      roomUrl: 'https://example.daily.co/dev-room',
      roomName: 'dev-room',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dailyCall/devRoom?roomUrl=https%3A%2F%2Fexample.daily.co%2Fdev-room&roomName=dev-room',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(deleted).toBe(true);
  });

  it('returns false when the request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({}) });

    const deleted = await requestDevRoomDeletion({});

    expect(deleted).toBe(false);
  });
});
