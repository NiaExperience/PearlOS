/* eslint-disable @typescript-eslint/no-explicit-any */
import { issueResetToken } from '../src/core/email';
import { UserActions } from '../src/core/actions';
import { POST_impl as completeResetPost } from '../src/core/routes/users/complete-reset/route';
import { NextRequest } from 'next/server';

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
});

describe('complete-reset route', () => {
  it('updates password with valid token and rejects reuse', async () => {
    const user = await UserActions.createUser({ email: 'reset-user@example.com', name: 'Reset User', password: 'OldPass123!' } as any);
    // @ts-ignore dynamic id shape
    const uid: string = (user.id || user._id).toString();
  const token = await issueResetToken(uid, user.email as string);
    const req = new NextRequest('http://localhost/api/users/complete-reset', {
      method: 'POST',
      body: JSON.stringify({ token, password: 'NewPass123!', confirmPassword: 'NewPass123!' }),
      headers: { 'Content-Type': 'application/json' }
    } as any);
    const res = await completeResetPost(req, {} as any);
    const json = await res.json();
    expect(json.success).toBe(true);

    const reqReuse = new NextRequest('http://localhost/api/users/complete-reset', {
      method: 'POST',
      body: JSON.stringify({ token, password: 'AnotherPass123!', confirmPassword: 'AnotherPass123!' }),
      headers: { 'Content-Type': 'application/json' }
    } as any);
    const resReuse = await completeResetPost(reqReuse, {} as any);
    const jsonReuse = await resReuse.json();
    expect(jsonReuse.success).toBe(false);
  });

  it('rejects invalid token', async () => {
    const badReq = new NextRequest('http://localhost/api/users/complete-reset', {
      method: 'POST',
      body: JSON.stringify({ token: 'invalid', password: 'NewPass123!', confirmPassword: 'NewPass123!' }),
      headers: { 'Content-Type': 'application/json' }
    } as any);
    const res = await completeResetPost(badReq, {} as any);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
