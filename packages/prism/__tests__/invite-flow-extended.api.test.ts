import { NextRequest } from 'next/server';
import { POST_impl as invitePost } from '../src/core/routes/users/invite/route';
import { POST_impl as acceptInvitePost } from '../src/core/routes/users/accept-invite/route';
import { UserActions } from '../src/core/actions';
import { issueResetToken, issueInviteToken, consumeResetToken } from '../src/core/email';

// Helper to build a NextRequest with JSON body & optional headers
function buildRequest(url: string, method: string, body: any, headers: Record<string,string> = {}) {
  return new NextRequest(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('invite workflow (extended scenarios)', () => {
  let inviter: any;
  beforeAll(async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
    }
  process.env.RESET_TOKEN_PERSISTENCE = 'disabled'; // default to memory path for isolation unless explicitly testing persistence
    inviter = await UserActions.createUser({ name: 'Inviter', email: 'inviter@example.com', password: 'StrongPass123!' } as any);
  });

  it('rejects invite when unauthenticated (no header)', async () => {
  const original = process.env.TEST_REQUIRE_AUTH_HEADER;
  process.env.TEST_REQUIRE_AUTH_HEADER = 'true';
    const req = buildRequest('http://localhost/api/users/invite', 'POST', { email: 'unauthd-target@example.com' });
    const res = await invitePost(req as any, {} as any);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
  process.env.TEST_REQUIRE_AUTH_HEADER = original;
  });

  it('conflicts when inviting already active user', async () => {
    const active = await UserActions.createUser({ name: 'Active', email: 'already-active@example.com', password: 'ActivePass123!' } as any);
    const req = buildRequest('http://localhost/api/users/invite', 'POST', { email: active.email }, { 'x-test-user-id': inviter._id });
    const res = await invitePost(req as any, {} as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already active/i);
  });

  it('verifies user state pre- and post- acceptance & password authentication works', async () => {
    const email = 'state-check@example.com';
    // Issue invite (authenticated)
    const reqInvite = buildRequest('http://localhost/api/users/invite', 'POST', { email }, { 'x-test-user-id': inviter._id });
    const resInvite = await invitePost(reqInvite as any, {} as any);
    const jsonInvite = await resInvite.json();
    expect(jsonInvite.success).toBe(true);
    const token = jsonInvite.token as string;
    const provisional = await UserActions.getUserByEmail(email.toLowerCase());
    expect(provisional).toBeTruthy();
    expect((provisional as any).password_hash).toBeFalsy(); // pre-activation
    // Accept invite
    const reqAccept = buildRequest('http://localhost/api/users/accept-invite', 'POST', { token, password: 'AcceptPass123!', confirmPassword: 'AcceptPass123!' });
    const resAccept = await acceptInvitePost(reqAccept as any, {} as any);
    expect(resAccept.status).toBe(200);
    const jsonAccept = await resAccept.json();
    expect(jsonAccept.success).toBe(true);
    const activated = await UserActions.getUserByEmail(email.toLowerCase());
    expect((activated as any).password_hash).toBeTruthy();
    // Verify password works
    const verify = await UserActions.verifyUserPassword((activated as any)._id, 'AcceptPass123!');
    expect(verify).toBe(true);
  });

  it('fails to accept with password_reset token (purpose mismatch)', async () => {
    const user = await UserActions.createUser({ name: 'Mismatch', email: 'purpose-mismatch@example.com' } as any);
    // direct issue a password reset token (purpose default)
    const token = await issueResetToken((user as any)._id, user.email as string); // default is password_reset
    const reqAccept = buildRequest('http://localhost/api/users/accept-invite', 'POST', { token, password: 'SomePass123!', confirmPassword: 'SomePass123!' });
    const res = await acceptInvitePost(reqAccept as any, {} as any);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/invalid|expired/i);
  });

  it('rejects expired invite token (short TTL)', async () => {
    const user = await UserActions.createUser({ name: 'Expiring', email: 'expiring-invite@example.com' } as any);
    // Manually issue invite token with very short TTL (5ms)
    const token = await issueResetToken((user as any)._id, user.email as string, { purpose: 'invite_activation', ttlMs: 5 });
    // wait to ensure expiry
    await new Promise(r => setTimeout(r, 25));
    const reqAccept = buildRequest('http://localhost/api/users/accept-invite', 'POST', { token, password: 'LatePass123!', confirmPassword: 'LatePass123!' });
    const res = await acceptInvitePost(reqAccept as any, {} as any);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/invalid|expired/i);
  });

  it('persists + consumes invite token with default persistence (flag not disabled)', async () => {
    const original = process.env.RESET_TOKEN_PERSISTENCE;
    delete process.env.RESET_TOKEN_PERSISTENCE; // default enabled
    try {
      const email = 'persist-invite@example.com';
      const newUser = await UserActions.createUser({ name: 'PersistInvite', email } as any);
      const token = await issueInviteToken((newUser as any)._id, email, 0.001); // ~3.6 seconds; accept before expiry
      const reqAccept = buildRequest('http://localhost/api/users/accept-invite', 'POST', { token, password: 'PersistPass123!', confirmPassword: 'PersistPass123!' });
      const res = await acceptInvitePost(reqAccept as any, {} as any);
      const json = await res.json();
      expect(json.success).toBe(true);
      // Single-use enforcement (persistence path)
      const resReuse = await acceptInvitePost(reqAccept as any, {} as any);
      const reuseJson = await resReuse.json();
      expect(reuseJson.success).toBe(false);
      // Direct consume call should also return null now
      const consumeAgain = await consumeResetToken(token, ['invite_activation']);
      expect(consumeAgain).toBeNull();
    } finally {
      process.env.RESET_TOKEN_PERSISTENCE = original;
    }
  });
});
