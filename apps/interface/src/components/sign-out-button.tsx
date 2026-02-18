'use client';

import { LogOut, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

import { Avatar, AvatarFallback, AvatarImage } from '@interface/components/ui/avatar';
import { Button } from '@interface/components/ui/button';
import { useUI } from '@interface/contexts/ui-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';

const authLogger = getClientLogger('[auth]');

// eslint-disable-next-line complexity
export function SignOutButton() {
  const router = useRouter();
  const { data: session, status } = useResilientSession();
  const { isBrowserWindowMaximized } = useUI();

  if (status === 'loading') return null;

  // Hide the sign out button when browser window is maximized
  if (isBrowserWindowMaximized) return null;

  // If anonymous user, show Sign In button with user icon
  if (session?.user?.is_anonymous) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push('/login')}
        className="fixed right-4 top-4 z-50 flex items-center gap-2 px-3 py-2 text-white/90 hover:bg-white hover:text-black border border-white/20 rounded-md transition-colors duration-200 group"
        title="Sign in"
        type="button"
      >
        <span aria-hidden className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-current opacity-0 group-hover:opacity-100 transition-opacity"></span>
        <User className="h-4 w-4" />
        <span className="text-sm font-medium">Sign In</span>
      </Button>
    );
  }

  // Helpers to keep handler complexity low
  const getCurrentOriginAndPath = (): { origin: string; callbackPath: string } => {
    if (typeof window === 'undefined') return { origin: '', callbackPath: '/' };
    try {
      const u = new URL(window.location.href);
      return { origin: u.origin, callbackPath: u.pathname + u.search + u.hash };
    } catch {
      return { origin: '', callbackPath: '/' };
    }
  };

  const toAbsolute = (origin: string, path: string): string => {
    if (!path) return origin || '/';
    if (!origin) return path;
    return origin.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
  };

  const serverSignOut = async (absoluteCallback: string): Promise<string | null> => {
    const res = await fetch(`/api/auth/signout?callbackUrl=${encodeURIComponent(absoluteCallback)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    type SignoutResponse = { success: boolean; redirect?: string };
    try {
      const data = (await res.json()) as SignoutResponse;
      return data.redirect ?? null;
    } catch {
      return null;
    }
  };

  // Otherwise, show user avatar with Sign Out functionality
  // eslint-disable-next-line complexity
  const handleSignOut = async () => {
    try {
      // Dispatch event to notify avatar that logout is starting
      // This allows the avatar to trigger return animation before session is cleared
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('user:logout:start', {
          detail: { reason: 'user_initiated' }
        }));
      }

      // Give a small delay to allow animation to start before clearing session
      await new Promise(resolve => setTimeout(resolve, 100));

      const { origin, callbackPath } = getCurrentOriginAndPath();
      const absoluteCallback = toAbsolute(origin, callbackPath || '/');
      const redirectFromApi = await serverSignOut(absoluteCallback);

      // Also call NextAuth's signOut to clear client-side state
      await signOut({ redirect: false });

      // Wait for avatar return animation to complete (3 seconds) before navigating
      // This ensures the reverse sparks animation is visible
      await new Promise(resolve => setTimeout(resolve, 3000));

      const nextTarget = redirectFromApi || callbackPath || '/';
      const absoluteNext = toAbsolute(origin, nextTarget);
      const enc = encodeURIComponent(absoluteNext || '/');
      router.replace(`/login?callbackUrl=${enc}`);
      router.refresh();
    } catch (error) {
      authLogger.error('Error during sign-out', {
        event: 'sign_out_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const user = session?.user;
  const userInitial = user?.name?.charAt(0) || user?.email?.charAt(0) || '?';

  return (
    <div
      className="fixed right-4 top-4 z-[60] flex items-center gap-2 pointer-events-auto isolate"
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onMouseDown={(e) => { e.stopPropagation(); }}
    >
      <Avatar className="h-8 w-8 border border-gray-600/30">
        {user?.image ? (
          <AvatarImage src={user.image} alt={user?.name || user?.email || ''} />
        ) : null}
        <AvatarFallback className="bg-gray-800 text-sm font-medium text-white">
          {userInitial}
        </AvatarFallback>
      </Avatar>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSignOut}
        className="relative group flex items-center gap-2 px-3 py-2 text-white/90 hover:bg-white hover:text-black border border-white/20 rounded-md transition-colors duration-200 pointer-events-auto"
        style={{ pointerEvents: 'auto' }}
        type="button"
        title="Sign out"
      >
        <span aria-hidden className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-current opacity-0 group-hover:opacity-100 transition-opacity"></span>
        <LogOut className="h-4 w-4" />
        <span className="text-sm font-medium">Sign Out</span>
      </Button>
    </div>
  );
}
