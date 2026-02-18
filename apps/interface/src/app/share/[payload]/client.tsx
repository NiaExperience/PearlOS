'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';

interface ShareRedemptionProps {
  token: string;
  resourceId: string;
  contentType: string;
  mode: string;
  assistantName?: string;
  isPearlosOnly?: boolean;
}

function redirectContentResource({
  router,
  assistantName,
  pearlosOnlyFlag,
  resourceId,
  resourceType,
  mode,
  locked,
}: {
  router: ReturnType<typeof useRouter>;
  assistantName: string;
  pearlosOnlyFlag: boolean;
  resourceId: string;
  resourceType: string;
  mode: string;
  locked: boolean;
}) {
  let targetPath = `/${assistantName}`;
  if (assistantName === 'pearlos' && pearlosOnlyFlag) {
    targetPath = '/';
  }

  const qs = new URLSearchParams({
    resourceId,
    contentType: resourceType,
    mode,
    locked: locked ? 'true' : 'false',
    source: 'share',
  });

  router.push(`${targetPath}?${qs.toString()}`);
}

function redirectDailyCall({
  router,
  assistantName,
  pearlosOnlyFlag,
  resourceId,
  mode,
  isSuccess,
}: {
  router: ReturnType<typeof useRouter>;
  assistantName: string;
  pearlosOnlyFlag: boolean;
  resourceId: string;
  mode: string;
  isSuccess: boolean;
}) {
  try {
    sessionStorage.setItem('dailySharedRoomUrl', resourceId);
    sessionStorage.setItem('dailySharedAssistant', assistantName);
    sessionStorage.setItem('dailySharedIntent', isSuccess ? 'open' : 'open_unlocked');
    sessionStorage.setItem('dailySharedMode', mode || '');
  } catch (_) {
    // ignore storage failures (private mode, etc.)
  }

  let targetPath = `/${assistantName}`;
  if (assistantName === 'pearlos' && pearlosOnlyFlag) {
    targetPath = '/';
  }
  const qs = new URLSearchParams({ source: 'daily-share', roomUrl: resourceId });
  if (mode) {
    qs.set('mode', mode);
  }
  qs.set('assistant', assistantName);
  router.replace(`${targetPath}?${qs.toString()}`);
}

async function processShareRedemption({
  token,
  resourceId,
  contentType,
  mode,
  initialAssistantName,
  pearlosOnlyFlag,
  router,
}: {
  token: string;
  resourceId: string;
  contentType: string;
  mode: string;
  initialAssistantName?: string;
  pearlosOnlyFlag: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const res = await fetch('/api/share/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });

  const data = await res.json();
  const normalized = normalizeShareResponse({
    responseOk: res.ok,
    data,
    resourceId,
    contentType,
    mode,
    initialAssistantName,
  });

  routeShareResource({
    normalized,
    router,
    pearlosOnlyFlag,
  });
}

function normalizeShareResponse({
  responseOk,
  data,
  resourceId,
  contentType,
  mode,
  initialAssistantName,
}: {
  responseOk: boolean;
  data: any;
  resourceId: string;
  contentType: string;
  mode: string;
  initialAssistantName?: string;
}) {
  const safeData = data || {};
  const resolvedResourceId = firstNonEmpty(safeData.resourceId, resourceId);
  const resolvedResourceType = firstNonEmpty(safeData.resourceType, contentType);
  const resolvedMode = firstNonEmpty(safeData.targetMode, mode, 'creative');
  const resolvedAssistant = firstNonEmpty(initialAssistantName, safeData.assistantName, 'pearlos');

  return {
    resourceId: resolvedResourceId,
    resourceType: resolvedResourceType,
    mode: resolvedMode,
    assistantName: resolvedAssistant,
    isSuccess: responseOk,
    error: safeData.error,
  };
}

function routeShareResource({
  normalized,
  router,
  pearlosOnlyFlag,
}: {
  normalized: ReturnType<typeof normalizeShareResponse>;
  router: ReturnType<typeof useRouter>;
  pearlosOnlyFlag: boolean;
}) {
  if (!normalized.resourceId || !normalized.resourceType) {
    throw new Error(normalized.error || 'Invalid share link: missing resource info');
  }

  if (normalized.resourceType === 'HtmlGeneration' || normalized.resourceType === 'Notes' || normalized.resourceType === 'Sprite') {
    redirectContentResource({
      router,
      assistantName: normalized.assistantName,
      pearlosOnlyFlag,
      resourceId: normalized.resourceId,
      resourceType: normalized.resourceType,
      mode: normalized.mode,
      locked: normalized.isSuccess,
    });
    return;
  }

  if (normalized.resourceType === 'DailyCallRoom') {
    redirectDailyCall({
      router,
      assistantName: normalized.assistantName,
      pearlosOnlyFlag,
      resourceId: normalized.resourceId,
      mode: normalized.mode,
      isSuccess: normalized.isSuccess,
    });
    return;
  }

  throw new Error('Unknown resource type');
}

function firstNonEmpty(...values: Array<string | undefined | null>) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

function BackgroundShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-shell" style={{ background: '#05030f', minHeight: '100vh' }}>
      <div
        className="animated-bg"
        style={{
          background:
            'radial-gradient(circle at 30% -10%, rgba(243, 104, 224, 0.35), transparent), radial-gradient(circle at 70% 110%, rgba(0, 210, 211, 0.25), transparent), #05030f',
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
        }}
      ></div>
      <main
        className="login-content-layer"
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        {children}
      </main>
    </div>
  );
}

function ErrorCard({ message }: { message: string | null }) {
  return (
    <div
      className="error-container"
      style={{
        background: 'rgba(15, 15, 35, 0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '20px',
        padding: '40px',
        textAlign: 'center',
        maxWidth: '500px',
        width: '90%',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>
      <h1
        style={{
          color: '#ff6b6b',
          background: 'linear-gradient(135deg, #ff6b6b 0%, #ff8e8e 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontSize: '28px',
          fontWeight: 'bold',
          marginBottom: '16px',
        }}
      >
        Error
      </h1>
      <p
        style={{
          color: '#a0a0a0',
          fontSize: '16px',
          marginBottom: '24px',
          lineHeight: '1.5',
        }}
      >
        {message}
      </p>
    </div>
  );
}

function LoadingCard() {
  return (
    <div
      className="error-container"
      style={{
        background: 'rgba(15, 15, 35, 0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '20px',
        padding: '40px',
        textAlign: 'center',
        maxWidth: '500px',
        width: '90%',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
      }}
    >
      <h1
        style={{
          color: '#ffffff',
          fontSize: '24px',
          fontWeight: 'bold',
          marginBottom: '24px',
        }}
      >
        Accessing Shared Resource...
      </h1>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
    </div>
  );
}

export function ShareRedemptionClient({ 
  token, 
  resourceId, 
  contentType, 
  mode,
  assistantName: initialAssistantName,
  isPearlosOnly
}: ShareRedemptionProps) {
  const router = useRouter();
  const { status } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const hasRedeemedRef = useRef(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      // Should be handled by middleware, but just in case
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.href)}`);
      return;
    }

    if (redeeming || hasRedeemedRef.current) return;

    const redeem = async () => {
      setRedeeming(true);
      hasRedeemedRef.current = true;
      const pearlosOnlyFlag =
        typeof isPearlosOnly === 'boolean' ? isPearlosOnly : process.env.PEARLOS_ONLY === 'true';
      try {
        await processShareRedemption({
          token,
          resourceId,
          contentType,
          mode,
          initialAssistantName,
          pearlosOnlyFlag,
          router,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An unknown error occurred';
        setError(message);
      } finally {
        setRedeeming(false);
      }
    };

    void redeem();
  }, [status, redeeming, router, token, resourceId, contentType, mode, initialAssistantName, isPearlosOnly]);

  if (error) {
    return (
      <BackgroundShell>
        <ErrorCard message={error} />
      </BackgroundShell>
    );
  }

  return (
    <BackgroundShell>
      <LoadingCard />
    </BackgroundShell>
  );
}
