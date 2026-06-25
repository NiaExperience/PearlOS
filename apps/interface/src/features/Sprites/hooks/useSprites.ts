import { useEffect, useCallback, useSyncExternalStore } from 'react';

import type { SpriteData, SpriteType, SummonOptions, SummonState } from '../types';
import { inferSummonOptions } from './inferSummonOptions';

type StreamMessage =
  | { type: 'log'; message: string }
  | { type: 'result'; data: Record<string, unknown> }
  | { type: 'error'; error: string; details?: string };

/** Decode an image URL fully before resolving so the next render paints clean. */
async function preloadImage(url: string): Promise<void> {
  if (!url || typeof window === 'undefined') return;
  const img = new Image();
  img.src = url;
  if (typeof img.decode === 'function') {
    try {
      await img.decode();
      return;
    } catch {
      // decode() rejects on some valid images; fall through to onload
    }
  }
  await new Promise<void>((resolve) => {
    if (img.complete) return resolve();
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

/** Call the real /api/summon-ai-sprite endpoint and stream progress */
async function generateSprite(
  prompt: string,
  options?: SummonOptions,
  onLog?: (message: string) => void,
): Promise<SpriteData> {
  const requestBody: Record<string, unknown> = { prompt };
  if (options) {
    requestBody.kind = options.kind;
    if ('size' in options && typeof options.size === 'number') requestBody.size = options.size;
    if ('preset' in options && options.preset) requestBody.preset = options.preset;
    if ('width' in options && typeof options.width === 'number') requestBody.width = options.width;
    if ('height' in options && typeof options.height === 'number') requestBody.height = options.height;
  }

  const res = await fetch('/api/summon-ai-sprite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    throw new Error(`Sprite API returned ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as StreamMessage;
        if (msg.type === 'log') {
          onLog?.(msg.message);
        } else if (msg.type === 'error') {
          throw new Error(msg.details || msg.error);
        } else if (msg.type === 'result') {
          result = msg.data;
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (!result) throw new Error('No result received from sprite generation');

  // Extract the best image URL: prefer GIF (animated), fall back to source image
  const gif = result.gif as { url?: string } | undefined;
  const sourceImage = result.sourceImage as { url?: string } | undefined;
  const imageUrl = gif?.url || sourceImage?.url || '';
  const isAnimated = !!gif?.url;
  const kind = (result.kind as string) || 'character';
  const type: SpriteType =
    kind === 'background' ? 'background' :
    kind === 'icon' ? 'icon' :
    'character';

  return {
    id: (result.spriteId as string) || crypto.randomUUID(),
    name: (result.spriteName as string) || 'Sprite',
    prompt,
    imageUrl,
    type,
    width: typeof result.width === 'number' ? (result.width as number) : undefined,
    height: typeof result.height === 'number' ? (result.height as number) : undefined,
    createdAt: new Date(),
    isAnimated,
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Module-level sprite session store
 *
 * Why this exists: the Sprites window is a transient ManeuverableWindow.
 * Closing the window unmounts SpritesApp; if generation state lived in
 * component state, the in-flight summon's setState calls would no-op on
 * unmount and the user would lose all evidence the summon was running.
 *
 * State (sprites, summonState, activeSprite, progressLog) lives in a
 * singleton outside the React tree and is also mirrored to localStorage so
 * it survives a tab reload too. The hook subscribes via useSyncExternalStore
 * — re-mounting SpritesApp instantly picks up whatever state the in-flight
 * fetch has reached.
 * ───────────────────────────────────────────────────────────────────── */

interface SpriteSessionState {
  sprites: SpriteData[];
  summonState: SummonState;
  activeSprite: SpriteData | null;
  selectedSprite: SpriteData | null;
  progressLog: string;
  loaded: boolean;
}

const INITIAL_STATE: SpriteSessionState = {
  sprites: [],
  summonState: 'idle',
  activeSprite: null,
  selectedSprite: null,
  progressLog: '',
  loaded: false,
};

const PERSIST_KEY = 'pearl-sprite-session-v1';

function reviveSprite(s: any): SpriteData {
  return {
    ...s,
    createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
  } as SpriteData;
}

function loadPersisted(): Partial<SpriteSessionState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      sprites: Array.isArray(parsed?.sprites) ? parsed.sprites.map(reviveSprite) : [],
      activeSprite: parsed?.activeSprite ? reviveSprite(parsed.activeSprite) : null,
      summonState: parsed?.summonState as SummonState | undefined,
      progressLog: typeof parsed?.progressLog === 'string' ? parsed.progressLog : '',
    };
  } catch {
    return null;
  }
}

function savePersisted(state: SpriteSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    const snapshot = {
      sprites: state.sprites.slice(0, 50),
      activeSprite: state.activeSprite,
      summonState: state.summonState,
      progressLog: state.progressLog,
    };
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota or serialization failure — non-critical.
  }
}

class SpriteSessionStore {
  private state: SpriteSessionState = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private listFetchStarted = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const persisted = loadPersisted();
      if (persisted) {
        this.state = {
          ...this.state,
          ...persisted,
          // If the previous tab died mid-summon, the in-flight fetch did
          // not survive page unload. Surface that as 'idle' with a hint.
          summonState:
            persisted.summonState === 'summoning' ? 'idle' : (persisted.summonState ?? 'idle'),
          progressLog:
            persisted.summonState === 'summoning'
              ? 'Last summon was interrupted — try again.'
              : (persisted.progressLog ?? ''),
        };
      }
    }
  }

  getSnapshot = (): SpriteSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    savePersisted(this.state);
    this.listeners.forEach((l) => l());
  }

  private set(patch: Partial<SpriteSessionState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  setSelectedSprite = (sprite: SpriteData | null) => {
    this.set({ selectedSprite: sprite });
  };

  ensureLoaded = async () => {
    if (this.listFetchStarted) return;
    this.listFetchStarted = true;
    try {
      const res = await fetch('/api/summon-ai-sprite/list?includeGif=1&limit=50');
      if (!res.ok) {
        this.set({ loaded: true });
        return;
      }
      const data = await res.json();
      const persisted: SpriteData[] = (data.sprites || [])
        .filter((s: Record<string, unknown>) => s.gifData || s.imageUrl || s.staticImageData)
        .map((s: Record<string, unknown>) => {
          const hasGif = !!s.gifData;
          const imageUrl = hasGif
            ? `data:${(s.gifMimeType as string) || 'image/gif'};base64,${s.gifData as string}`
            : s.imageUrl
              ? (s.imageUrl as string)
              : `data:${(s.staticMimeType as string) || 'image/png'};base64,${s.staticImageData as string}`;
          return {
            id: s._id as string,
            name: (s.name as string) || 'Sprite',
            prompt: (s.originalRequest as string) || '',
            imageUrl,
            type: 'character' as const,
            createdAt: new Date((s.createdAt as string) || Date.now()),
            isAnimated: hasGif,
          };
        });
      if (persisted.length > 0) {
        const mostRecent = [...persisted].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )[0];
        const prismIds = new Set(persisted.map((p) => p.id));
        const localOnly = this.state.sprites.filter((s) => !prismIds.has(s.id));
        this.set({
          sprites: [...localOnly, ...persisted],
          activeSprite: this.state.activeSprite ?? mostRecent,
          loaded: true,
        });
      } else {
        this.set({ loaded: true });
      }
    } catch (e) {
      console.error('Failed to load sprites from Prism:', e);
      this.set({ loaded: true });
    }
  };

  summon = async (prompt: string, options?: SummonOptions) => {
    if (!prompt.trim()) return;
    if (this.state.summonState === 'summoning' || this.state.summonState === 'materializing') {
      // A summon is already running; ignore duplicate clicks rather than
      // racing two fetches and clobbering each other's results.
      return;
    }
    this.set({
      activeSprite: null,
      summonState: 'summoning',
      progressLog: 'Summoning sprite...',
    });

    const resolvedOptions = options ?? inferSummonOptions(prompt);

    try {
      const sprite = await generateSprite(prompt, resolvedOptions, (msg) => {
        this.set({ progressLog: msg });
      });
      // Decode the new image off-DOM before mounting it. Without this the
      // <img> mounts and the browser starts decoding mid-materialize, which
      // showed as a stale/old-sprite flash on slower devices.
      await preloadImage(sprite.imageUrl);
      this.set({
        activeSprite: sprite,
        sprites: [sprite, ...this.state.sprites],
        summonState: 'materializing',
        progressLog: '',
      });
      await new Promise((r) => setTimeout(r, 600));
      this.set({ summonState: 'complete' });
      setTimeout(() => {
        if (this.state.summonState === 'complete') {
          this.set({ summonState: 'idle' });
        }
      }, 2000);
    } catch (err) {
      console.error('Sprite generation failed:', err);
      this.set({
        progressLog:
          err instanceof Error ? 'The summons faltered. Try again?' : 'The summons faltered.',
        summonState: 'idle',
      });
    }
  };
}

const spriteSessionStore = new SpriteSessionStore();

if (typeof window !== 'undefined') {
  // External callers (voice / bot) dispatch this event to trigger a summon.
  // Bind once at module load so a remounting SpritesApp never double-binds.
  const w = window as any;
  if (!w.__pearlSpriteSummonHandlerBound) {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        spriteSessionStore.summon(detail.prompt, detail.options as SummonOptions | undefined);
      }
    };
    window.addEventListener('spriteSummonRequest', handler);
    w.__pearlSpriteSummonHandlerBound = true;
  }
}

export function useSprites() {
  const state = useSyncExternalStore(
    spriteSessionStore.subscribe,
    spriteSessionStore.getSnapshot,
    spriteSessionStore.getSnapshot,
  );

  useEffect(() => {
    spriteSessionStore.ensureLoaded();
  }, []);

  const setSelectedSprite = useCallback(
    (sprite: SpriteData | null) => spriteSessionStore.setSelectedSprite(sprite),
    [],
  );
  const summon = useCallback(
    (prompt: string, options?: SummonOptions) => spriteSessionStore.summon(prompt, options),
    [],
  );

  return {
    sprites: state.sprites,
    summonState: state.summonState,
    activeSprite: state.activeSprite,
    selectedSprite: state.selectedSprite,
    setSelectedSprite,
    summon,
    progressLog: state.progressLog,
  };
}
