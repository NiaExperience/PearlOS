"use client";
import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@interface/components/ui/card';
import { Input } from '@interface/components/ui/input';
import { Button } from '@interface/components/ui/button';
import { signIn } from 'next-auth/react';

export function AcceptInvite() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get('token') || '';
  const assistant = searchParams?.get('assistant') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const urlError = searchParams?.get('error');

  useEffect(() => {
    if (!token) {
      setError('Missing invite token. Please use the link from your email.');
    }
    // Probe the token to infer invited email and whether it's a Gmail address
    (async () => {
      if (!token) return;
      try {
        const res = await fetch(`/api/users/verify-invite?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok && data?.success && data.email) {
          setInviteEmail(data.email);
        }
      } catch {}
    })();
  }, [token]);

  useEffect(() => {
    if (!urlError) return;
    const map: Record<string, string> = {
      EmailMismatch: 'The Google account you used does not match the invited email. Please switch accounts or use password setup.',
      InvalidOrExpired: 'This invite link is invalid or expired.',
      MissingToken: 'Missing invite token. Please use the link from your email.',
    };
    setError(map[urlError] || 'Unable to complete Google sign-in for this invite.');
  }, [urlError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/users/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invite acceptance failed');
      }
      // Try to create a session for the newly activated user using a server redirect
      try {
        const email = data.email as string | undefined;
        if (email) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const cbUrl = assistant ? (origin ? new URL(`/${assistant}`, origin).toString() : `/${assistant}`) : (origin ? origin + '/' : '/');
          await signIn('credentials', {
            redirect: true,
            email,
            password,
            callbackUrl: cbUrl,
          });
          return; // signIn will navigate
        }
      } catch {}
        // Fallback: route to assistant or login without auto-login
        if (assistant) {
          setMessage('Account activated. Redirecting to your assistant...');
          setTimeout(() => router.push(`/${assistant}`), 500);
        } else {
          setMessage('Account activated. Redirecting to login...');
          setTimeout(() => router.push('/login'), 1000);
      }
    } catch (e: any) {
      setError(e.message || 'Invite acceptance failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md relative z-40 border-2"
        style={{
          backgroundColor: 'rgba(0,0,0,0.35)',
          borderColor: 'var(--theme-primary, rgba(255,255,255,0.15))'
        }}
      >
        <CardHeader>
          <CardTitle className="text-2xl" style={{ color: 'var(--theme-text-primary, #fafafa)' }}>Accept Invitation</CardTitle>
          <CardDescription className="" style={{ color: 'var(--theme-text-secondary, #d1d5db)' }}>
            {inviteEmail ? `Invited as ${inviteEmail}` : 'Set a password to activate your account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
      <Button
              type="button"
              className="w-full"
              style={{
                backgroundColor: 'var(--theme-primary, #2563eb)',
                color: 'var(--theme-text-primary, #ffffff)'
              }}
              variant="outline"
              onClick={() => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const defaultBase = process.env.NEXT_PUBLIC_INTERFACE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
        const nextUrl = origin ? new URL('/accept-invite/google-complete', origin) : new URL('/accept-invite/google-complete', defaultBase);
        if (token) nextUrl.searchParams.set('token', token);
        if (assistant) nextUrl.searchParams.set('assistant', assistant);
        // Navigate to server route which will verify token/session and initiate Google if needed.
        window.location.href = nextUrl.toString();
              }}
            >
              Continue with Google
            </Button>
            <div className="text-xs text-center mt-2" style={{ color: 'var(--theme-text-secondary, var(--muted-foreground))' }}>
              You can use Google to authenticate with your invited email instead of setting a password.
            </div>
            <div className="my-3 text-center text-xs text-muted-foreground">— or —</div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-sm mb-1" style={{ color: 'var(--theme-text-primary, #fafafa)' }}>New Password</label>
              <Input id="new-password" name="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={submitting || !token} required minLength={8} aria-required="true" className="bg-background text-foreground placeholder:text-muted-foreground" />
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm mb-1" style={{ color: 'var(--theme-text-primary, #fafafa)' }}>Confirm Password</label>
              <Input id="confirm-password" name="confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={submitting || !token} required minLength={8} aria-required="true" className="bg-background text-foreground placeholder:text-muted-foreground" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {message && <p className="text-sm" style={{ color: 'var(--theme-text-accent, #16a34a)' }}>{message}</p>}
            <Button type="submit" className="w-full"
              style={{
                backgroundColor: 'var(--theme-secondary, #10b981)',
                color: 'var(--theme-text-primary, #ffffff)'
              }}
              disabled={submitting || !token}>
              {submitting ? 'Activating...' : 'Activate Account'}
            </Button>
          </form>
          {!token && (
            <p className="mt-4 text-xs text-muted-foreground">No token present. Please use the invite link from your email.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AcceptInvite;
