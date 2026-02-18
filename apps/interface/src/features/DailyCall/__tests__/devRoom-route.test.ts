/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSessionSafely } from '@nia/prism/core/auth';
import type { NextRequest } from 'next/server';

import { deleteDevRoom } from '../lib/config';

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: { mock: 'auth-options' } }));

jest.mock('../lib/config', () => ({
  deleteDevRoom: jest.fn(),
}));

const mockGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;
const mockDeleteDevRoom = deleteDevRoom as jest.MockedFunction<typeof deleteDevRoom>;

const buildRequest = (query: string = ''): NextRequest =>
  ({
    url: `http://localhost:3000/api/dailyCall/devRoom${query ? `?${query}` : ''}`,
    headers: new Headers(),
  } as unknown as NextRequest);

const loadDeleteImpl = () => {
  let exports: any;
  jest.isolateModules(() => {
    exports = require('../routes/devRoomImpl');
  });
  return exports.DELETE_impl as (request: NextRequest) => Promise<Response>;
};

describe('dailyCall dev room route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when session is missing', async () => {
    mockGetSessionSafely.mockResolvedValue(null as any);
    const DELETE_impl = loadDeleteImpl();

    const res = await DELETE_impl(buildRequest());
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('unauthorized');
  });

  it('delegates deletion to Daily config helper with query params', async () => {
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1' } } as any);
    mockDeleteDevRoom.mockResolvedValue(true);
    const DELETE_impl = loadDeleteImpl();

    const res = await DELETE_impl(buildRequest('roomUrl=https://example.daily.co/dev-room&roomName=dev-room'));
    expect(mockDeleteDevRoom).toHaveBeenCalledWith({
      roomUrl: 'https://example.daily.co/dev-room',
      roomName: 'dev-room',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
  });
});
