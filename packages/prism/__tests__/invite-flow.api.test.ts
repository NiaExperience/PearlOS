import { NextRequest } from 'next/server';
import { POST_impl as invitePost } from '../src/core/routes/users/invite/route';
import { POST_impl as acceptInvitePost } from '../src/core/routes/users/accept-invite/route';
import { UserActions } from '../src/core/actions';
import { issueInviteToken } from '../src/core/email';

jest.mock('../src/core/email', () => {
  const actual = jest.requireActual('../src/core/email');
  return {
    ...actual,
    // Delegate to real implementation so record is stored (memory path) but shorten TTL a bit
    issueInviteToken: jest.fn(async (userId: string, email: string) => {
      return actual.issueInviteToken(userId, email, 1); // 1 hour TTL is enough for test
    })
  };
});

// Helper to build a request with body
function buildRequest(url: string, method: string, body: any, headers: Record<string,string> = {}) {
  return new NextRequest(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('invite workflow', () => {
  let sessionUser: any;
  beforeAll(async () => {
    // Ensure encryption key present in isolated worker (tests run in parallel)
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
    }
  process.env.RESET_TOKEN_PERSISTENCE = 'disabled'; // speed: avoid DB persistence path
    sessionUser = await UserActions.createUser({ name: 'Admin', email: 'admin-invite@example.com', password: 'Password123!' } as any);
  });

  it('issues invite token for new user', async () => {
    const req = buildRequest('http://localhost/api/users/invite', 'POST', { email: 'new-invitee@example.com' }, { 'x-test-user-id': sessionUser._id });
  const res = await invitePost(req as any, {} as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.invited).toBe(true);
  });

  it('activates user via accept-invite', async () => {
    const email = 'activate-me@example.com';
    const reqInvite = buildRequest('http://localhost/api/users/invite', 'POST', { email }, { 'x-test-user-id': sessionUser._id });
    const resInvite = await invitePost(reqInvite as any, {} as any);
    const jsonInvite = await resInvite.json();
    expect(jsonInvite.success).toBe(true);
    expect(jsonInvite.token).toBeTruthy();
    const token = jsonInvite.token as string;
    // Accept invite
    const reqAccept = buildRequest('http://localhost/api/users/accept-invite', 'POST', { token, password: 'NewPass123!', confirmPassword: 'NewPass123!' });
    const resAccept = await acceptInvitePost(reqAccept as any, {} as any);
    const jsonAccept = await resAccept.json();
    expect(jsonAccept.success).toBe(true);
    // Reuse should fail
    const reqReuse = buildRequest('http://localhost/api/users/accept-invite', 'POST', { token, password: 'AnotherPass123!', confirmPassword: 'AnotherPass123!' });
    const resReuse = await acceptInvitePost(reqReuse as any, {} as any);
    const jsonReuse = await resReuse.json();
    expect(jsonReuse.success).toBe(false);
  });
});
