'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect, Suspense, useRef, useState } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

const analyticsLogger = getClientLogger('[analytics]');

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      process.env.NEXT_PUBLIC_POSTHOG_KEY &&
      (process.env.NEXT_PUBLIC_POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_PROXY_HOST)
    ) {
      const apiHost = process.env.NEXT_PUBLIC_POSTHOG_PROXY_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST;
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: apiHost,
        // Create profiles for identified users.
        // For anonymous users, we rely on PostHog's default behavior until we identify them.
        defaults: '2025-11-30',
        person_profiles: 'identified_only',
        capture_pageview: false, // We handle pageviews manually
        debug: process.env.NODE_ENV !== 'production',
        loaded: (ph) => {
          analyticsLogger.info('PostHog loaded', {
            event: 'posthog_loaded',
            apiHost: (ph as any).config?.api_host,
          });
          setIsLoaded(true);
        },
      });
    }
  }, []);

  return (
    <PHProvider client={posthog}>
      <PostHogAuthWrapper isLoaded={isLoaded}>
        {children}
      </PostHogAuthWrapper>
    </PHProvider>
  );
}

function PostHogAuthWrapper({ children, isLoaded }: { children: React.ReactNode, isLoaded: boolean }) {
  const { data: session } = useSession();

  useEffect(() => {
    // Wait for PostHog to be loaded before identifying
    if (!isLoaded) return;

    // If we have a session with a user ID, identify the user in PostHog
    if (session?.user?.id) {
      analyticsLogger.info('PostHog identifying user', {
        event: 'posthog_identify',
        userId: session.user.id,
        isAnonymous: session.user.is_anonymous,
      });
      posthog.identify(session.user.id, {
        email: session.user.email,
        name: session.user.name,
        is_anonymous: session.user.is_anonymous,
      });
    } else if (session === null) {
      // User is not authenticated. PostHog uses its own anonymous ID.
      // If the user logs out, we typically want to reset the PostHog session
      // to avoid linking future events to the previous user.
      analyticsLogger.info('PostHog resetting session', {
        event: 'posthog_reset',
      });
      posthog.reset();
    }
  }, [session, isLoaded]);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </>
  );
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Track the last captured URL to prevent duplicate events if effects run twice (e.g. strict mode)
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname;
      if (searchParams && searchParams.toString()) {
        url = url + `?${searchParams.toString()}`;
      }

      // Simple check to avoid duplicate pageviews in strict mode development
      if (url !== lastUrlRef.current) {
        lastUrlRef.current = url;
        posthog.capture('$pageview', {
          '$current_url': url,
        });
      }
    }
  }, [pathname, searchParams]);

  return null;
}
