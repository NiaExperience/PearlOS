'use client';

import { SessionProvider } from 'next-auth/react';
import React, { useEffect } from 'react';
import { getLogger } from '../../logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AuthProviderClient({ 
  children, 
  session, 
  basePath = '/api/auth' 
}: { 
  children: React.ReactNode; 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  basePath?: string;
}) {
  useEffect(() => {
    const logger = getLogger('prism:auth:client');
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      try {
        // Simple check to avoid property access errors
        if (!event || !event.reason) return;

        const isAuthSessionError = 
          typeof event.reason.message === 'string' && 
          event.reason.message.indexOf('fetch') !== -1 &&
          typeof event.reason.url === 'string' && 
          event.reason.url.indexOf('/auth/session') !== -1;

        if (isAuthSessionError) {
          // Safe logging with minimal property access
          logger.error('Session fetch error', {
            message: String(event.reason.message || ''),
            url: String(event.reason.url || ''),
            name: String(event.reason.name || ''),
          });
          
          // Prevent the error from bubbling up
          event.preventDefault();
        }
      } catch (error) {
        // Fail silently to prevent error handler crashes
        logger.error('Error in rejection handler', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  return (
    <SessionProvider
      session={session}
      basePath={basePath}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
} 