import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

import { clientLogger } from '@interface/lib/client-logger';

export function useResilientSession() {
  // In some test/CI environments the next-auth useSession mock may not be applied
  // early enough, briefly returning undefined. Guard against that so components
  // never crash while the mock/provider initializes.
  const raw = useSession as unknown as (() => any) | undefined;
  // Call the hook if it exists; otherwise fall back to a minimal loading shape.
  const sessionResult: any = typeof raw === 'function' ? raw() : { data: null, status: 'loading' };
  const [hasError, setHasError] = useState(false);
  
  const status: string = sessionResult?.status || 'loading';

  useEffect(() => {
    // Reset error state when session status changes
    if (status !== 'loading') {
      setHasError(false);
    }
  }, [status]);
  
  // Add error logging
  useEffect(() => {
    if (status === 'loading') {
      const timeoutId = setTimeout(() => {
        clientLogger.warn('Session fetch taking longer than expected', {
          event: 'session_fetch_timeout',
          timeoutMs: 3000,
        });
      }, 3000);
      return () => clearTimeout(timeoutId);
    }
  }, [status]);
  
  // Ensure we always return a stable shape
  return {
    data: sessionResult?.data ?? null,
    status,
    hasError,
  };
}