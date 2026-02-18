import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

export function useResilientSession() {
  const raw = useSession as unknown as (() => any) | undefined;
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
        console.warn('Session fetch taking longer than expected');
      }, 3000);
      return () => clearTimeout(timeoutId);
    }
  }, [status]);
  
  return {
    data: sessionResult?.data ?? null,
    status,
    hasError,
  };
}