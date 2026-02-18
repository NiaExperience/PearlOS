import { NextRequest } from 'next/server';

// Mock auth helper so we can control session presence
jest.mock('@nia/prism/core/auth', () => ({ getSessionSafely: jest.fn() }));
// Mock actions module up-front so route import uses mocks
jest.mock('../src/core/actions/reset-password-token-actions', () => ({
  getResetPasswordTokenById: jest.fn(),
  deleteResetPasswordToken: jest.fn(),
  incrementResetPasswordTokenAttempts: jest.fn(),
  createResetPasswordToken: jest.fn(),
  getResetPasswordTokenByHash: jest.fn(),
  consumeResetPasswordToken: jest.fn()
}));

const { getSessionSafely } = require('@nia/prism/core/auth');
const actions = require('../src/core/actions/reset-password-token-actions');
import { GET_impl } from '../src/core/routes/admin/tokens/route';
import { DELETE_impl } from '../src/core/routes/admin/token/[id]/route';
import { Prism } from '../src/prism';

describe('admin token core routes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
  });

  it('GET_impl returns 401 when no session', async () => {
    (getSessionSafely as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/admin/tokens');
    const res = await GET_impl(req as any, {} as any);
    expect(res.status).toBe(401);
  });

  it('GET_impl returns filtered active tokens', async () => {
    (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    const now = Date.now();
    const fakeItems = [
      { _id: '1', userId: 'uA', email: 'a@example.com', purpose: 'password_reset', expiresAt: new Date(now + 60000).toISOString(), consumedAt: null, attempts: 0, tokenHash: 'h1' },
      { _id: '2', userId: 'uB', email: 'b@example.com', purpose: 'invite_activation', expiresAt: new Date(now - 1000).toISOString(), consumedAt: null, attempts: 0, tokenHash: 'h2' },
      { _id: '3', userId: 'uC', email: 'c@example.com', purpose: 'password_reset', expiresAt: new Date(now + 60000).toISOString(), consumedAt: new Date().toISOString(), attempts: 2, tokenHash: 'h3' }
    ];
    // Patch Prism.getInstance to control query output
    (Prism as any).getInstance = jest.fn(async () => ({ query: jest.fn().mockResolvedValue({ items: fakeItems, total: fakeItems.length, hasMore: false }) }));
    const req = new NextRequest('http://localhost/api/admin/tokens?active=1');
    const res = await GET_impl(req as any, {} as any);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    // Only first token should survive active filter
    expect(json.items.length).toBe(1);
    expect(json.items[0].id).toBe('1');
  });

  it('DELETE_impl unauthorized', async () => {
    (getSessionSafely as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/admin/token/abc');
    const res = await DELETE_impl(req as any, { params: { id: 'abc' } }, {} as any);
    expect(res.status).toBe(401);
  });

  it('DELETE_impl 404 when missing', async () => {
    (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (actions.getResetPasswordTokenById as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/admin/token/missing');
    const res = await DELETE_impl(req as any, { params: { id: 'missing' } }, {} as any);
    expect(res.status).toBe(404);
  });

  it('DELETE_impl success', async () => {
    (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (actions.getResetPasswordTokenById as jest.Mock).mockResolvedValue({ _id: 'tok1' });
    (actions.deleteResetPasswordToken as jest.Mock).mockResolvedValue(true);
    const req = new NextRequest('http://localhost/api/admin/token/tok1');
    const res = await DELETE_impl(req as any, { params: { id: 'tok1' } }, {} as any);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
  });

  it('DELETE_impl handles delete failure', async () => {
    (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (actions.getResetPasswordTokenById as jest.Mock).mockResolvedValue({ _id: 'tok2' });
    (actions.deleteResetPasswordToken as jest.Mock).mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/token/tok2');
    const res = await DELETE_impl(req as any, { params: { id: 'tok2' } }, {} as any);
    expect(res.status).toBe(500);
  });
});
