'use client';

import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { PasswordSetupForm } from '@nia/prism/core/components/PasswordSetupForm';
import { useRouter } from 'next/navigation';
import { LoginForm } from '@dashboard/components/login-form';
import { ThemeToggle } from '../../components/theme-toggle';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // If user is already authenticated, redirect to dashboard
    if (status === 'authenticated' && session) {
      router.push('/dashboard');
    }
    // If session exists but is invalid, sign out
    if (status === 'authenticated' && !session?.user?.email) {
      signOut({ redirect: false });
    }
  }, [session, status, router]);

  // Force session refresh to clear any stale state
  useEffect(() => {
    // This will trigger a session refresh when the component mounts
    // This helps clear any stale session state that might persist
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If user is signed in via credentials but must set password (invited / provisional)
  if (status === 'authenticated' && (session as any)?.user?.mustSetPassword && !(session as any)?.user?.google_access_token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="mb-6 text-center max-w-md">
          <h1 className="text-2xl font-semibold mb-2">Set Your Password</h1>
          <p className="text-sm text-muted-foreground">Your account was created without a password. Please set one now to complete setup.</p>
        </div>
        <PasswordSetupForm onSuccess={() => { window.location.href = '/dashboard'; }} />
        <button onClick={() => signOut({ redirect: true })} className="mt-6 text-xs text-muted-foreground underline">Sign out</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark:bg-slate-900 text-foreground relative overflow-hidden">
      {/* Nia Logo - Top Left */}
      <div className='fixed top-10 left-12 z-50'>
        <img
          src="/Nia Logo 1.svg"
          alt="Nia Logo"
          className="w-16 h-16"
        />
      </div>

      {/* Theme Toggle */}
      <div className='fixed top-6 right-6 z-50'>
        <ThemeToggle />
      </div>

      {/* Main Content */}
      <div className="flex h-screen w-full">
        {/* Left Hero Section */}
        <div className="flex-1 flex items-center justify-start pl-12 pr-8">
          <div className="max-w-lg">
            <h1 className="text-5xl font-bold leading-tight mb-4 text-foreground">
              Easily manage your voice concierge in one dashboard.
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              Our login process is quick and easy, taking no more than 5 minutes to complete.
            </p>
          </div>
        </div>

        {/* Right Login Section */}
        <div className="flex-1 flex items-center justify-center p-16">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
