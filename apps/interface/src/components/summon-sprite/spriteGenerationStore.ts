/**
 * spriteGenerationStore.ts
 *
 * Module-level store for the sprite-summoning UI. Tracks the in-flight
 * lifecycle plus the displayed sprite (gif / source image) and the
 * loading flag, so all of it survives a mount/unmount of
 * `SummonSpritePrompt`.
 *
 * Why this exists: the summon panel is conditionally rendered (only in
 * QUIET mode), so closing it mid-generation tears down the React tree
 * that owns this state. The streaming fetch keeps running, but its
 * `setState` calls land on a dead component instance, so the panel
 * reopens to a fresh, empty UI. Lifting the state here lets a remounted
 * panel re-attach to the live progress and pick up the finished sprite.
 *
 * The store owns:
 *   - lifecycle status (idle / pending / complete / error)
 *   - loading flag (true while a summon or recall is in flight)
 *   - the active AbortController so any mount can cancel a running summon
 *   - the currently-displayed sprite (gif + sourceImage) so close+reopen
 *     restores the visible avatar
 *
 * Sprite identity (id, name, voice) still rides on the `complete` state
 * for the existing subscribe/apply hydration; recall flows write display
 * fields directly via `setDisplayedSprite`.
 */

import type { ImageResult, ApiResultData } from './spriteTypes';

export interface PendingSummon {
  status: 'pending';
  prompt: string;
  bubbleLine: string;
  startedAt: number;
  /** Server-side job id (returned in the first stream chunk). When set,
   *  a remounted client can poll /api/summon-ai-sprite/job/:id and pick
   *  up a finished result that streamed past a closed panel/tab.
   *  See SPECTRUM bug #4. */
  jobId?: string;
}

export interface CompleteSummon {
  status: 'complete';
  prompt: string;
  result: ApiResultData;
}

export interface ErrorSummon {
  status: 'error';
  prompt: string;
  error: string;
}

export interface IdleSummon {
  status: 'idle';
}

export type SummonState =
  | IdleSummon
  | PendingSummon
  | CompleteSummon
  | ErrorSummon;

export interface SpriteUiState {
  loading: boolean;
  gif: ImageResult | null;
  sourceImage: ImageResult | null;
}

// ── localStorage persistence ──────────────────────────────────────────
// We persist state + uiState across full tab/browser close so an
// in-flight summon (or its finished sprite) survives a reload. The
// AbortController is intentionally NOT persisted: a remount cannot
// resume the original streaming connection. Instead, a `pending` state
// older than PENDING_REVIVE_MAX_AGE_MS is treated as orphaned and
// surfaced as an `error` so the user can retry.
const STORAGE_KEY = 'pearl-sprite-store-v1';
const PENDING_REVIVE_MAX_AGE_MS = 90_000; // 90s — covers a slow generation but not an abandoned tab

interface PersistedShape {
  state: SummonState;
  uiState: SpriteUiState;
}

function loadPersisted(): PersistedShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.state || !parsed.uiState) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersisted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state, uiState }),
    );
  } catch {
    /* quota / SSR */
  }
}

function reviveInitialState(): { state: SummonState; uiState: SpriteUiState } {
  const persisted = loadPersisted();
  if (!persisted) {
    return {
      state: { status: 'idle' },
      uiState: { loading: false, gif: null, sourceImage: null },
    };
  }
  // A pending state cannot resume the original streaming fetch — that
  // belonged to the previous page lifetime. If a server-side jobId was
  // captured before the panel closed, we keep the `pending` UI live and
  // schedule a background poll that hydrates from /job/:id; otherwise
  // we fall back to the legacy "interrupted, please retry" behaviour.
  // See SPECTRUM bug #4.
  if (persisted.state.status === 'pending') {
    const age = Date.now() - persisted.state.startedAt;
    const hasJobId = typeof persisted.state.jobId === 'string' && persisted.state.jobId.length > 0;
    if (hasJobId && age < PENDING_REVIVE_MAX_AGE_MS) {
      // Schedule the hydrate poll out of band so module evaluation stays
      // synchronous (this runs at import time during SSR/hydrate).
      const jobId = persisted.state.jobId as string;
      const prompt = persisted.state.prompt;
      if (typeof window !== 'undefined') {
        Promise.resolve().then(() => hydrateFromJob(jobId, prompt));
      }
      return {
        state: persisted.state,
        uiState: { ...persisted.uiState, loading: true },
      };
    }
    if (age < PENDING_REVIVE_MAX_AGE_MS) {
      return {
        state: {
          status: 'error',
          prompt: persisted.state.prompt,
          error: 'Generation was interrupted. Tap Summon to retry.',
        },
        uiState: { ...persisted.uiState, loading: false },
      };
    }
    return {
      state: { status: 'idle' },
      uiState: { ...persisted.uiState, loading: false },
    };
  }
  return {
    state: persisted.state,
    uiState: { ...persisted.uiState, loading: false },
  };
}

// ── Background job hydrator ───────────────────────────────────────────
// When a remount sees a `pending` state with a jobId, we poll the
// server's job endpoint until it's `complete`/`error` or it stops being
// findable. The cap matches the route-side TTL so we never spin
// forever.
const JOB_POLL_INTERVAL_MS = 2_000;
const JOB_POLL_MAX_ATTEMPTS = 60; // ≈ 2 minutes

async function hydrateFromJob(jobId: string, prompt: string): Promise<void> {
  for (let attempt = 0; attempt < JOB_POLL_MAX_ATTEMPTS; attempt++) {
    // Stop polling if the user has moved on (e.g. kicked off a new
    // summon, manually cleared, or the lifecycle resolved via a
    // surviving fetch).
    if (state.status !== 'pending' || (state as PendingSummon).jobId !== jobId) return;
    try {
      const res = await fetch(`/api/summon-ai-sprite/job/${encodeURIComponent(jobId)}`);
      if (res.status === 404) {
        // Job aged out before we could read it — surface as an error so
        // the user can retry instead of spinning forever.
        markError(prompt, 'Generation could not be recovered. Tap Summon to retry.');
        return;
      }
      if (res.ok) {
        const body = await res.json();
        const j = body?.job;
        if (j?.status === 'complete' && j.result) {
          markComplete(prompt, j.result as ApiResultData);
          return;
        }
        if (j?.status === 'error') {
          markError(prompt, typeof j.error === 'string' ? j.error : 'Generation failed.');
          return;
        }
        if (j?.status && typeof j.bubbleLine === 'string') {
          updatePendingBubble(j.bubbleLine);
        }
      }
    } catch {
      // Network blip — keep trying until we hit the attempt cap.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
  if (state.status === 'pending' && (state as PendingSummon).jobId === jobId) {
    markError(prompt, 'Generation timed out. Tap Summon to retry.');
  }
}

const __initial = reviveInitialState();
let state: SummonState = __initial.state;
let uiState: SpriteUiState = __initial.uiState;
const subscribers = new Set<() => void>();
let activeAbortController: AbortController | null = null;

export function getSummonState(): SummonState {
  return state;
}

export function getSpriteUiState(): SpriteUiState {
  return uiState;
}

export function subscribeSummon(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function notify() {
  // Persist before notifying so subscribers that re-read storage on
  // state-change see consistent state.
  savePersisted();
  subscribers.forEach((cb) => {
    try {
      cb();
    } catch {
      /* never let one bad subscriber break the others */
    }
  });
}

function updateUi(patch: Partial<SpriteUiState>): void {
  const next = { ...uiState, ...patch };
  if (
    next.loading === uiState.loading &&
    next.gif === uiState.gif &&
    next.sourceImage === uiState.sourceImage
  ) {
    return;
  }
  uiState = next;
}

export function markPending(prompt: string, controller?: AbortController): void {
  activeAbortController = controller ?? null;
  state = {
    status: 'pending',
    prompt,
    bubbleLine: 'Calling forth the essence...',
    startedAt: Date.now(),
  };
  // Don't clear the displayed sprite — the previous avatar should stay
  // visible while the new one generates.
  updateUi({ loading: true });
  notify();
}

export function abortActiveSummon(): boolean {
  const c = activeAbortController;
  if (!c) return false;
  try {
    c.abort();
  } catch {
    /* ignore */
  }
  activeAbortController = null;
  return true;
}

export function updatePendingBubble(message: string): void {
  if (state.status !== 'pending') return;
  state = { ...state, bubbleLine: message };
  notify();
}

/**
 * Record the server-side jobId on the in-flight pending state. The
 * route emits this as the very first stream chunk so a remount can
 * hydrate via /api/summon-ai-sprite/job/:id even if the original
 * streaming reader died. See SPECTRUM bug #4.
 */
export function setPendingJobId(jobId: string): void {
  if (state.status !== 'pending') return;
  if (state.jobId === jobId) return;
  state = { ...state, jobId };
  notify();
}

export function markComplete(prompt: string, result: ApiResultData): void {
  activeAbortController = null;
  state = { status: 'complete', prompt, result };
  updateUi({
    loading: false,
    gif: result.gif ?? null,
    sourceImage: result.sourceImage ?? null,
  });
  notify();
}

export function markError(prompt: string, error: string): void {
  activeAbortController = null;
  state = { status: 'error', prompt, error };
  updateUi({ loading: false });
  notify();
}

export function markIdle(): void {
  activeAbortController = null;
  state = { status: 'idle' };
  updateUi({ loading: false });
  notify();
}

/**
 * Set the loading flag without changing the lifecycle status. Used by
 * the recall flow, which has its own AbortController and is not tied to
 * the summon lifecycle.
 */
export function setLoading(loading: boolean): void {
  if (uiState.loading === loading) return;
  updateUi({ loading });
  notify();
}

/**
 * Replace the currently-displayed sprite (e.g. from a recall). Does not
 * change the lifecycle status.
 */
export function setDisplayedSprite(
  gif: ImageResult | null,
  sourceImage: ImageResult | null,
): void {
  updateUi({ gif, sourceImage });
  notify();
}

/**
 * Clear the displayed sprite (e.g. dismiss). Does not change lifecycle
 * status, but does drop any cached gif/sourceImage so the avatar layer
 * unmounts.
 */
export function clearDisplayedSprite(): void {
  updateUi({ gif: null, sourceImage: null });
  notify();
}
