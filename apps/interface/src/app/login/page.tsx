'use client';
import { isGuestLoginAllowed } from '@nia/prism/core';
import { PasswordSetupForm } from '@nia/prism/core/components/PasswordSetupForm';
import { useSession, signOut, signIn } from 'next-auth/react';
import React from 'react';

import LoginForm from '@interface/components/login-form';
import { useGlobalSettings } from '@interface/providers/global-settings-provider';

// Helpers to keep effect complexity low
function parseAssistantFromCallback(callbackUrl: string | null, origin: string): string {
  try {
    const cb = callbackUrl || '/';
    const u = new URL(cb, origin);
    return (u.pathname.split('/').filter(Boolean)[0]) || '';
  } catch {
    return '';
  }
}

async function assistantDisallowsAnonymous(agent: string): Promise<boolean> {
  try {
    if (!agent) return false;
    const resp = await fetch(`/api/assistant/meta?agent=${encodeURIComponent(agent)}`, { cache: 'no-store' });
    if (!resp.ok) return false;
    const meta: { allowAnonymousLogin?: boolean; supportedFeatures?: unknown } = await resp.json();
    return !isGuestLoginAllowed(meta);
  } catch {
    return false;
  }
}

export default function LoginPage() {
/* eslint-disable complexity */
  const { data: session, status } = useSession();
  const { interfaceLogin } = useGlobalSettings();
  // Note: login page infers assistant via callbackUrl; no direct use of searchParams here
  // If an existing session is anonymous but the assistant disallows anonymous, reset the session
  React.useEffect(() => {
    const run = async () => {
      if (typeof window === 'undefined') return;
      const isGuest = Boolean((session as unknown as { user?: { is_anonymous?: boolean } })?.user?.is_anonymous);
      if (status !== 'authenticated' || !isGuest) return;

      if (!interfaceLogin.guestLogin) {
        await signOut({ redirect: false });
        window.location.replace(window.location.href);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const assistant = parseAssistantFromCallback(params.get('callbackUrl'), window.location.origin);
      if (!assistant) return;

      if (await assistantDisallowsAnonymous(assistant)) {
        await signOut({ redirect: false });
        window.location.replace(window.location.href);
      }
    };
    void run();
  }, [status, session, interfaceLogin.guestLogin]);

  // Auto-start guest session for local flows (e.g. /pearlos -> /login?autoguest=1)
  React.useEffect(() => {
    const run = async () => {
      if (typeof window === 'undefined') return;
      if (!interfaceLogin.guestLogin) return;
      if (status !== 'unauthenticated') return;

      const params = new URLSearchParams(window.location.search);
      if (params.get('autoguest') !== '1') return;

      const callbackUrl = params.get('callbackUrl') || '/';
      const assistant = parseAssistantFromCallback(callbackUrl, window.location.origin);
      if (!assistant) return;

      // Only auto-guest when the assistant allows anonymous sessions
      if (await assistantDisallowsAnonymous(assistant)) return;

      // Create a real NextAuth session cookie (so /api/users/me etc work)
      await signIn('credentials', { redirect: true, isAnonymous: true, callbackUrl });
    };
    void run();
  }, [interfaceLogin.guestLogin, status]);
  // Auto-start Google OAuth when coming from invite completion flow
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!interfaceLogin.googleAuth) return;
    const params = new URLSearchParams(window.location.search);
    const auto = params.get('autoGoogle');
    if (auto === '1') {
      const callbackUrl = params.get('callbackUrl') || '/';
      const login_hint = params.get('login_hint') || undefined;
      // Kick off Google OAuth and let NextAuth handle redirect back
      signIn('google', { callbackUrl, login_hint, prompt: 'select_account' });
    }
  }, [interfaceLogin.googleAuth]);

  // Show loading state while session is being determined
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (status === 'authenticated' && (session as unknown as { user?: { mustSetPassword?: boolean; google_access_token?: string, email: string } })?.user?.mustSetPassword && !(session as unknown as { user?: { mustSetPassword?: boolean; google_access_token?: string, email: string } })?.user?.google_access_token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="mb-6 text-center max-w-md">
          <h1 className="text-2xl font-semibold mb-2">Set Your Password</h1>
          <p className="text-sm text-gray-600">Your account was created without a password. Please set one now to continue.</p>
        </div>
        <PasswordSetupForm onSuccess={() => { window.location.href = '/'; }} />
        <button onClick={() => {
          let callbackPath = '/';
          let absolute = '/';
          try {
            if (typeof window !== 'undefined') {
              const u = new URL(window.location.href);
              callbackPath = u.pathname + u.search + u.hash;
              const base = (u.origin || '').replace(/\/$/, '');
              absolute = base + (callbackPath.startsWith('/') ? callbackPath : '/' + callbackPath);
            }
          } catch (_) { /* ignore */ }
          signOut({ callbackUrl: absolute, redirect: true });
        }} className="mt-6 text-xs text-gray-500 underline">Sign out</button>
      </div>
    );
  }
  return <LoginForm />;
/* eslint-enable complexity */
} 
