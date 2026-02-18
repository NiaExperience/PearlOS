/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';

import { Skeleton } from '@interface/components/ui/skeleton';
import { getClientLogger } from '@interface/lib/client-logger';

import { HtmlGenerationViewer } from './HtmlGenerationViewer';

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gohufont-font-face')) return;
  const style = document.createElement('style');
  style.id = 'gohufont-font-face';
  style.textContent = GOHUFONT_FONT_FACE;
  document.head.appendChild(style);
};

/**
 * HtmlGenerationFlow
 * Orchestrates a single end-to-end html generation request (fast vs advanced) and
 * renders the resulting html via the real HtmlGenerationViewer component.
 * Includes cancellation safeguards (ignore late resolves after unmount) and exposes
 * deterministic data-testid markers used by the E2E tests.
 */
export interface HtmlGenerationFlowProps {
  request: string;
  mode: 'fast' | 'advanced';
  id?: string; // optional prefix for multiple concurrent flows in tests
  isAdmin?: boolean; // Optional prop to override admin status
}

// FIX: Enhanced GenerationState interface with status and progress fields
interface GenerationState {
  status: 'idle' | 'initializing' | 'generating' | 'pending' | 'ready' | 'error';
  progress: number; // 0-100
  html: string;
  provider: string;
  data: any | null;
  phase?: string; // Current generation phase
  callId?: string; // Correlates with status polling
}

export const HtmlGenerationFlow: React.FC<HtmlGenerationFlowProps> = ({ request, mode, id, isAdmin }) => {
  const log = React.useMemo(() => getClientLogger('[html-generation.flow]'), []);
  // FIX: Initialize state with enhanced fields
  const [state, setState] = React.useState<GenerationState>({ 
    status: 'idle', 
    progress: 0, 
    html: '', 
    provider: '', 
    data: null,
    phase: undefined
  });

  React.useEffect(() => {
    ensureGohufont();
  }, []);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      // FIX: Enhanced state update with progress tracking
      setState(s => ({ ...s, status: 'initializing', progress: 0, html: '', provider: '', data: null, phase: 'Initializing generation...' }));
      
      // Set to generating after initialization
      setState(s => ({ ...s, status: 'generating', progress: 10, phase: 'Generating content...' }));
      
      try {
        const body = {
          title: request.slice(0, 40) || 'Untitled',
          description: request,
          userRequest: request,
          contentType: 'game',
          useOpenAI: mode === 'fast'
        };
        log.info('HtmlGenerationFlow: request', { body });
        const res = await fetch('/api/html-generation', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
          signal: controller.signal
        });
        log.info('HtmlGenerationFlow: response', { status: res.status });
        if (!res.ok) throw new Error('bad status');
        const json: any = await res.json();
        if (!active) return; // cancelled
        const data = json?.data;
        if (!json?.success || !data) {
          setState(s => ({ ...s, status: 'error' }));
          return;
        }
        // Move to pending state; actual readiness will be driven by status polling
        setState(s => ({
          ...s,
          status: 'pending',
          progress: 10, // keep initial small progress
          html: data.htmlContent || '', // may already have html if synchronous
          provider: data.aiProvider || 'unknown',
          data,
          phase: 'Queued for generation...',
          callId: data.callId
        }));

        // Begin polling if we have a callId
        if (data.callId) {
          const pollIntervalMs = 2000;
          const maxDurationMs = 600_000; // allow up to 10 minutes
          const start = Date.now();
          const poll = async () => {
            if (!active) return;
            if (Date.now() - start > maxDurationMs) {
              log.warn('HtmlGenerationFlow: polling timeout', { callId: data.callId, durationMs: Date.now() - start });
              return;
            }
            try {
              const statusRes = await fetch('/api/html-generation/status', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ callId: data.callId })
              });
              if (!statusRes.ok) throw new Error('bad status poll');
              const statusJson: any = await statusRes.json();
              if (!active) return;
              if (!statusJson?.success) throw new Error('status not success');
              setState(s => ({
                ...s,
                progress: statusJson.progress ?? s.progress,
                phase: statusJson.phase || s.phase
              }));
              if (statusJson.isComplete) {
                setState(s => ({
                  ...s,
                  status: 'ready',
                  progress: 100,
                  phase: 'Generation complete'
                }));
                return; // stop polling
              }
            } catch (err) {
              log.warn('HtmlGenerationFlow: poll error', { err, callId: data.callId });
            }
            setTimeout(poll, pollIntervalMs);
          };
          poll();
        } else {
          // Fallback: no callId, treat as ready to preserve legacy behavior
          setState(s => ({ ...s, status: 'ready', progress: 100, phase: 'Generation complete' }));
        }
      } catch (e) {
        if (!active) return; // ignore after cancel
        setState(s => ({ ...s, status: 'error' }));
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [request, mode]);

  const prefix = id ? `${id}-` : '';

  return (
    <div
      data-testid={`${prefix}html-gen-root`}
      className="text-xs rounded-md border border-border bg-muted/30 p-3 space-y-2"
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div className="flex items-center justify-between">
        <div data-testid={`${prefix}status`} className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{state.status}</div>
        <div data-testid={`${prefix}provider`} className="text-[10px] text-muted-foreground">{state.provider}</div>
      </div>
      {(state.status === 'generating' || state.status === 'pending') && (
        <div className="space-y-2" data-testid={`${prefix}skeleton`}>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-32 w-full" />
          <div className="text-[10px] text-muted-foreground font-mono">
            {state.phase} {state.progress != null && <span>({state.progress}%)</span>}
          </div>
        </div>
      )}
      {/* TODO: Determine if this is safe and necessary */}
      <div data-testid={`${prefix}content`} className="prose prose-xs max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: state.html }} />
      {state.status === 'ready' && state.data && (
        <div className="border border-border rounded bg-background p-2">
          <HtmlGenerationViewer
            htmlGeneration={{
              _id: state.data._id || 'temp',
              title: state.data.title || request.slice(0, 40) || 'Untitled',
              htmlContent: state.html,
              contentType: state.data.contentType || 'game',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              tenantId: state.data.tenantId || 'test',
              isAiGenerated: true,
              userRequest: request,
              tags: []
            } as any}
            onClose={() => { /* no-op for test */ }}
            isFullscreen={false}
            onToggleFullscreen={() => {}}
            isAdmin={isAdmin} // Force admin mode to show edit controls
          />
        </div>
      )}
    </div>
  );
};

export default HtmlGenerationFlow;
