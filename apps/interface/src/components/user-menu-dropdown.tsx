'use client';

import { ChevronDown, LogOut, Settings, CreditCard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@interface/components/ui/avatar';
import { Button } from '@interface/components/ui/button';
import { useUI } from '@interface/contexts/ui-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';

export function UserMenuDropdown({ tenantId }: { tenantId?: string }) {
  const logger = getClientLogger('[user_menu_dropdown]');
  const router = useRouter();
  const { data: session, status } = useResilientSession();
  const { isBrowserWindowMaximized, isChatMode } = useUI();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (status === 'loading') return null;

  // Hide the user menu when browser window is maximized
  if (isBrowserWindowMaximized || isChatMode) return null;

  // If anonymous user, show Sign In button
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
        <Settings className="h-4 w-4" />
        <span className="text-sm font-medium">Sign In</span>
      </Button>
    );
  }

  const user = session?.user;
  const userInitial = user?.name?.charAt(0) || user?.email?.charAt(0) || '?';

  const handleSignOut = async () => {
    try {
      const { origin, callbackPath } = getCurrentOriginAndPath();
      const callbackUrl = toAbsolute(origin, callbackPath);
      
      await signOut({ 
        callbackUrl: callbackUrl,
        redirect: true 
      });
    } catch (error) {
      logger.error('Sign out error', {
        message: error instanceof Error ? error.message : String(error),
      });
      // Fallback to simple redirect
      window.location.href = '/login';
    }
  };

  const getCurrentOriginAndPath = (): { origin: string; callbackPath: string } => {
    if (typeof window === 'undefined') return { origin: '', callbackPath: '/' };
    try {
      const u = new URL(window.location.href);
      return { origin: u.origin, callbackPath: u.pathname + u.search + u.hash };
    } catch {
      return { origin: '', callbackPath: '/' };
    }
  };

  const toAbsolute = (origin: string, path: string): string =>
    path.startsWith('http') ? path : `${origin}${path.startsWith('/') ? path : `/${path}`}`;

  const handleSettingsClick = () => {
    setIsOpen(false);
    const url = tenantId ? `/settings?tenantId=${tenantId}` : '/settings';
    router.push(url);
  };

  const handleSubscriptionClick = () => {
    setIsOpen(false);
    router.push('/subscription');
  };

  return (
    <div
      ref={dropdownRef}
      className="fixed right-4 top-4 z-[60] flex items-center gap-2 pointer-events-auto isolate"
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onMouseDown={(e) => { e.stopPropagation(); }}
    >
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 text-white/90 hover:bg-white hover:text-black border border-white/20 rounded-md transition-colors duration-200 pointer-events-auto"
          style={{ pointerEvents: 'auto' }}
          type="button"
        >
          <Avatar className="h-6 w-6 border border-gray-600/30">
            {user?.image ? (
              <AvatarImage src={user.image} alt={user?.name || user?.email || ''} />
            ) : null}
            <AvatarFallback className="bg-gray-800 text-xs font-medium text-white">
              {userInitial}
            </AvatarFallback>
          </Avatar>
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </Button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-gray-900 rounded-md shadow-lg border border-gray-700 py-1 z-50">
            <button
              onClick={handleSettingsClick}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-3"
            >
              {/* Pixelated Settings Icon */}
              <div className="w-4 h-4" style={{
                imageRendering: 'pixelated',
                background: `
                  linear-gradient(45deg, #06b6d4 0%, #06b6d4 25%, transparent 25%, transparent 50%, #06b6d4 50%, #06b6d4 75%, transparent 75%, transparent 100%),
                  linear-gradient(45deg, #06b6d4 0%, #06b6d4 25%, transparent 25%, transparent 50%, #06b6d4 50%, #06b6d4 75%, transparent 75%, transparent 100%)
                `,
                backgroundSize: '4px 4px, 4px 4px',
                backgroundPosition: '0 0, 2px 2px'
              }} />
              Settings
            </button>
            <button
              onClick={handleSubscriptionClick}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-3"
            >
              {/* Pixelated Credit Card Icon */}
              <div className="w-4 h-4" style={{
                imageRendering: 'pixelated',
                background: `
                  linear-gradient(90deg, #a855f7 0%, #a855f7 100%),
                  linear-gradient(0deg, #a855f7 0%, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent 100%)
                `,
                backgroundSize: '100% 2px, 100% 100%',
                backgroundPosition: '0 0, 0 0'
              }} />
              Subscription
            </button>
            <hr className="my-1 border-gray-700" />
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-3"
            >
              {/* Pixelated Sign Out Icon */}
              <div className="w-4 h-4" style={{
                imageRendering: 'pixelated',
                background: `
                  linear-gradient(45deg, #22c55e 0%, #22c55e 50%, transparent 50%, transparent 100%),
                  linear-gradient(-45deg, #22c55e 0%, #22c55e 50%, transparent 50%, transparent 100%)
                `,
                backgroundSize: '2px 2px, 2px 2px',
                backgroundPosition: '0 0, 2px 2px'
              }} />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
