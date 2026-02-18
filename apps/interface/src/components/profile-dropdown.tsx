'use client';

import { LogOut, Settings, CreditCard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';

import { SettingsModal } from '@interface/components/settings-modal';
import { SubscriptionModal } from '@interface/components/subscription-modal';
import { Avatar, AvatarFallback, AvatarImage } from '@interface/components/ui/avatar';
import { Button } from '@interface/components/ui/button';
import { useUI } from '@interface/contexts/ui-context';
import { InviteViaEmailModal } from '@interface/features/InviteViaEmail';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';
import '../features/Notes/styles/notes.css';

export function ProfileDropdown( { tenantId }: { tenantId?: string }) {
  const logger = getClientLogger('[profile_dropdown]');
  const router = useRouter();
  const { data: session, status } = useResilientSession();
  const { isBrowserWindowMaximized, isChatMode } = useUI();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
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
  if (isBrowserWindowMaximized) return null;

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
        <span className="text-sm font-medium" style={{ fontFamily: 'Gohufont, monospace' }}>Sign In</span>
      </Button>
    );
  }

  const user = session?.user;
  const userInitial = user?.name?.charAt(0) || user?.email?.charAt(0) || '?';

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

  const handleSignOut = async () => {
    setIsOpen(false);
    setIsSigningOut(true);
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
      logger.error('Error during sign-out', {
        error: error instanceof Error ? error.message : String(error),
      });
      setIsSigningOut(false);
    }
  };

  const handleSettingsClick = () => {
    setIsOpen(false);
    setIsSettingsModalOpen(true);
  };

  const handleSubscriptionClick = () => {
    setIsOpen(false);
    setIsSubscriptionModalOpen(true);
  };

  const handleInviteClick = () => {
    setIsOpen(false);
    setIsInviteModalOpen(true);
  };

  return (
    <div
      ref={dropdownRef}
      className={`fixed right-4 top-4 z-[60] flex items-center gap-2 pointer-events-auto isolate ${isChatMode ? 'hidden' : ''}`}
      style={{ pointerEvents: isChatMode ? 'none' : 'auto' }}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onMouseDown={(e) => { e.stopPropagation(); }}
    >
      <div className="relative">
        <style>{`
          @keyframes pulseGlow {
            0% {
              transform: scale(1);
              box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.7);
            }
            50% {
              transform: scale(1.05);
              box-shadow: 0 0 0 8px rgba(168, 85, 247, 0);
            }
            100% {
              transform: scale(1);
              box-shadow: 0 0 0 0 rgba(168, 85, 247, 0);
            }
          }
          .pulse-glow {
            animation: pulseGlow 0.6s ease-out;
          }
        `}</style>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsPulsing(true);
            setIsOpen(!isOpen);
            setTimeout(() => setIsPulsing(false), 600);
          }}
          className={`flex items-center justify-center p-1 text-white/90 hover:bg-white/20 active:bg-white/30 rounded-full transition-all duration-200 pointer-events-auto ${isPulsing ? 'pulse-glow' : ''}`}
          style={{ pointerEvents: 'auto', fontFamily: 'Gohufont, monospace' }}
          type="button"
        >
          <Avatar className="h-8 w-8">
            {user?.image ? (
              <AvatarImage src={user.image} alt={user?.name || user?.email || ''} />
            ) : null}
            <AvatarFallback className="bg-gray-800/80 text-sm font-medium text-white" style={{ fontFamily: 'Gohufont, monospace' }}>
              {userInitial}
            </AvatarFallback>
          </Avatar>
        </Button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-gray-900 rounded-md shadow-lg border border-gray-700 py-1 z-50" style={{ fontFamily: 'Gohufont, monospace' }}>
            <button
              onClick={handleSettingsClick}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-3"
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              {/* Custom Settings Icon */}
              <img 
                src="/UsersettingIcon.png" 
                alt="Settings" 
                className="w-6 h-6"
                style={{ imageRendering: 'pixelated' }}
              />
              Settings
            </button>
            <button
              onClick={handleInviteClick}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-3"
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              {/* Invite icon from public assets */}
              <img 
                src="/invite.png" 
                alt="Invite Friend" 
                className="w-6 h-6"
                
              
              />
              Invite Friend
            </button>
            {/* <button
              onClick={handleSubscriptionClick}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-3"
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              <div className="w-6 h-6" style={{
                imageRendering: 'pixelated',
                background: `
                  linear-gradient(90deg, #a855f7 0%, #a855f7 100%),
                  linear-gradient(0deg, #a855f7 0%, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent 100%)
                `,
                backgroundSize: '100% 2px, 100% 100%',
                backgroundPosition: '0 0, 0 0',
                maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='square' stroke-linejoin='miter'%3E%3Crect x='1' y='4' width='22' height='16'%3E%3C/rect%3E%3Cline x1='1' y1='10' x2='23' y2='10'%3E%3C/line%3E%3C/svg%3E")`,
                maskRepeat: 'no-repeat',
                maskSize: 'contain',
                maskPosition: 'center'
              }} />
              Subscription
            </button> */}
            <hr className="my-1 border-gray-700" />
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-3"
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              {/* Custom Sign Out Icon */}
              <img 
                src="/signoutHome.png" 
                alt="Sign Out" 
                className="w-6 h-6"
                style={{ imageRendering: 'pixelated' }}
              />
              Sign Out
            </button>
          </div>
        )}
      </div>
      
      {/* Subscription Modal */}
      <SubscriptionModal 
        isOpen={isSubscriptionModalOpen} 
        onClose={() => setIsSubscriptionModalOpen(false)} 
      />
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsModalOpen} 
        onClose={() => setIsSettingsModalOpen(false)}
        tenantId={tenantId}
      />

      {/* Invite Friend Modal (8-bit themed) */}
      <InviteViaEmailModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
      />

      {/* Sign Out Loading Overlay */}
      {isSigningOut && (
        <>
          <style>{`
            @keyframes signingOutDot {
              0%, 20% { opacity: 0; }
              50% { opacity: 1; }
              100% { opacity: 0; }
            }
            .dot-1 { animation: signingOutDot 1.4s infinite; }
            .dot-2 { animation: signingOutDot 1.4s infinite 0.2s; }
            .dot-3 { animation: signingOutDot 1.4s infinite 0.4s; }
          `}</style>
          <div className="fixed inset-0 z-[650] bg-gray-900/95 flex items-center justify-center" style={{ fontFamily: 'Gohufont, monospace' }}>
            <div className="flex flex-col items-center gap-4">
              <div 
                className="w-8 h-8 rounded-full animate-spin"
                style={{
                  background: `conic-gradient(from 0deg, #a855f7, #3b82f6, #8b5cf6, #a855f7)`,
                  mask: 'radial-gradient(circle, transparent 60%, black 60%)',
                  WebkitMask: 'radial-gradient(circle, transparent 60%, black 60%)'
                }}
              />
              <p className="text-white text-lg font-medium flex items-center">
                Signing out
                <span className="ml-1 inline-flex">
                  <span className="dot-1">.</span>
                  <span className="dot-2">.</span>
                  <span className="dot-3">.</span>
                </span>
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}