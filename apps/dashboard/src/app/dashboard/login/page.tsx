'use client';

import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { PasswordSetupForm } from '@nia/prism/core/components/PasswordSetupForm';
import { useRouter } from 'next/navigation';
import { LoginForm } from '@dashboard/components/login-form';
import { ThemeToggle } from '../../../components/theme-toggle';
import { useState } from 'react';

export default function DashboardLoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && !session?.user?.email) {
      signOut({ redirect: false });
      return;
    }

    if (status === 'authenticated' && session?.user?.email) {
      let cancelled = false;
      setIsCheckingAccess(true);
      (async () => {
        try {
          const response = await fetch('/dashboard/api/users/me/tenant-roles', {
            credentials: 'include',
          });
          if (!response.ok) {
            throw new Error('Failed to resolve tenant roles');
          }
          const data = await response.json();
          const hasAdminAccess =
            data?.roles?.some((role: { role?: string }) => role.role === 'admin' || role.role === 'owner') || false;

          if (cancelled) return;
          if (hasAdminAccess) {
            router.push('/dashboard/assistants');
            return;
          }

          await signOut({ redirect: true, callbackUrl: '/dashboard/login?error=NoAccess' });
        } catch {
          if (!cancelled) {
            await signOut({ redirect: true, callbackUrl: '/dashboard/login?error=NoAccess' });
          }
        } finally {
          if (!cancelled) {
            setIsCheckingAccess(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [session, status, router]);

  if (status === 'loading' || isCheckingAccess) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (status === 'authenticated' && (session as any)?.user?.mustSetPassword && !(session as any)?.user?.google_access_token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="mb-6 text-center max-w-md">
          <h1 className="text-2xl font-semibold mb-2">Set Your Password</h1>
          <p className="text-sm text-muted-foreground">Your account was created without a password. Please set one now to complete setup.</p>
        </div>
        <PasswordSetupForm onSuccess={() => { window.location.href = '/dashboard/assistants'; }} />
        <button onClick={() => signOut({ redirect: true })} className="mt-6 text-xs text-muted-foreground underline">Sign out</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark:bg-slate-900 text-foreground relative overflow-hidden">
      <div className='fixed top-10 left-12 z-50'>
        <img
          src="/Nia Logo 1.svg"
          alt="Nia Logo"
          className="w-16 h-16"
        />
      </div>

      <div className='fixed top-6 right-6 z-50'>
        <ThemeToggle />
      </div>

      <div className="flex h-screen w-full">
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

        <div className="flex-1 flex items-center justify-center p-16">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
