import { NextRequest } from 'next/server';
import { POST_impl as invitePost } from '@nia/prism/core/routes/users/invite/route';
import { POST_impl as acceptInvitePost } from '@nia/prism/core/routes/users/accept-invite/route';
import { UserActions } from '@nia/prism/core/actions';

function buildRequest(url: string, method: string, body: any, headers: Record<string,string> = {}) {
  return new NextRequest(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('basic invite lifecycle (coverage)', () => {
  let inviter: any;
  beforeAll(async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
    }
    process.env.RESET_TOKEN_PERSISTENCE = 'disabled';
    inviter = await UserActions.createUser({ name: 'Inviter2', email: 'inviter2@example.com', password: 'StrongPass123!' } as any);
  });

  it('invites & accepts user', async () => {
    const email = 'basic-flow@example.com';
    const reqInvite = buildRequest('http://localhost/api/users/invite', 'POST', { email }, { 'x-test-user-id': inviter._id });
    const resInvite = await invitePost(reqInvite as any, {} as any);
    expect(resInvite.status).toBe(200);
    const jsonInvite = await resInvite.json();
    expect(jsonInvite.success).toBe(true);
    const token = jsonInvite.token as string;
    const reqAccept = buildRequest('http://localhost/api/users/accept-invite', 'POST', { token, password: 'BasicPass123!', confirmPassword: 'BasicPass123!' });
    const resAccept = await acceptInvitePost(reqAccept as any, {} as any);
    expect(resAccept.status).toBe(200);
  });
});
