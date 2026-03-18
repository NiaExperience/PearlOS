import { useState, useCallback, useEffect } from 'react';
import type { SpriteData, SummonState } from '../types';

type StreamMessage = 
  | { type: 'log'; message: string }
  | { type: 'result'; data: Record<string, unknown> }
  | { type: 'error'; error: string; details?: string };

/** Call the real /api/summon-ai-sprite endpoint and stream progress */
async function generateSprite(
  prompt: string,
  onLog?: (message: string) => void,
): Promise<SpriteData> {
  const res = await fetch('/api/summon-ai-sprite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
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

  return {
    id: (result.spriteId as string) || crypto.randomUUID(),
    name: (result.spriteName as string) || 'Sprite',
    prompt,
    imageUrl,
    type: 'character',
    createdAt: new Date(),
    isAnimated,
  };
}

export function useSprites() {
  const [sprites, setSprites] = useState<SpriteData[]>([]);
  const [summonState, setSummonState] = useState<SummonState>('idle');
  const [activeSprite, setActiveSprite] = useState<SpriteData | null>(null);
  const [selectedSprite, setSelectedSprite] = useState<SpriteData | null>(null);
  const [progressLog, setProgressLog] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  // Load persisted sprites from Prism on mount
  useEffect(() => {
    if (loaded) return;
    (async () => {
      try {
        const res = await fetch('/api/summon-ai-sprite/list?includeGif=1&limit=50');
        if (!res.ok) return;
        const data = await res.json();
        const persisted: SpriteData[] = (data.sprites || [])
          .filter((s: Record<string, unknown>) => s.gifData)
          .map((s: Record<string, unknown>) => ({
            id: s._id as string,
            name: (s.name as string) || 'Sprite',
            prompt: (s.originalRequest as string) || '',
            imageUrl: `data:${(s.gifMimeType as string) || 'image/gif'};base64,${s.gifData as string}`,
            type: 'character' as const,
            createdAt: new Date((s.createdAt as string) || Date.now()),
            isAnimated: true,
          }));
        if (persisted.length > 0) {
          setSprites(prev => {
            // Merge: keep any locally-generated sprites not yet in Prism
            const prismIds = new Set(persisted.map(p => p.id));
            const localOnly = prev.filter(s => !prismIds.has(s.id));
            return [...localOnly, ...persisted];
          });
        }
      } catch (e) {
        console.error('Failed to load sprites from Prism:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, [loaded]);

  const summon = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;
    setSummonState('summoning');
    setProgressLog('Initiating sprite summoning...');

    try {
      const sprite = await generateSprite(prompt, (msg) => {
        setProgressLog(msg);
      });
      setSummonState('materializing');
      setProgressLog('Materializing...');
      // Short delay for the materialize animation
      await new Promise((r) => setTimeout(r, 1200));
      setActiveSprite(sprite);
      setSprites((prev) => [sprite, ...prev]);
      setSummonState('complete');
      setProgressLog('');
      // Reset to idle after showing result
      setTimeout(() => setSummonState('idle'), 3000);
    } catch (err) {
      console.error('Sprite generation failed:', err);
      setProgressLog(err instanceof Error ? err.message : 'Generation failed');
      setSummonState('idle');
    }
  }, []);

  // Listen for external summon requests (from bot voice commands)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        summon(detail.prompt);
      }
    };
    window.addEventListener('spriteSummonRequest', handler);
    return () => window.removeEventListener('spriteSummonRequest', handler);
  }, [summon]);

  return {
    sprites,
    summonState,
    activeSprite,
    selectedSprite,
    setSelectedSprite,
    summon,
    progressLog,
  };
}
