'use client';

import React, { useMemo, useState } from 'react';

type ImageResult = {
    url: string;
    filename?: string;
    subfolder?: string;
    type?: string;
};

type ApiResponse =
    | { error: string; details?: string; promptId?: string }
    | {
          promptId: string;
          animationPromptId?: string;
          sourceImage?: ImageResult;
          gif?: ImageResult;
          images?: ImageResult[];
      };

const defaultPrompt = 'A doctor';
const BUBBLE_LINES = [
    'Hi! Did you call me?',
    'Ready to help—just say the word.',
    'Listening in the corner over here.',
    'Hey there! Need a sprite sidekick?',
    'Standing by for your next request.',
    'Yo! Want me to animate something?',
];

export default function SummonAiSpriteClient() {
    const [prompt, setPrompt] = useState(defaultPrompt);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [gif, setGif] = useState<ImageResult | null>(null);
    const [sourceImage, setSourceImage] = useState<ImageResult | null>(null);
    const [images, setImages] = useState<ImageResult[]>([]);
    const [promptId, setPromptId] = useState<string | null>(null);
    const [animationPromptId, setAnimationPromptId] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const [gifKey, setGifKey] = useState(0);
    const [bubbleText, setBubbleText] = useState(BUBBLE_LINES[0]);

    const disabled = useMemo(() => loading || prompt.trim().length === 0, [loading, prompt]);
    const displayUrl = isPlaying ? gif?.url ?? '' : sourceImage?.url ?? gif?.url ?? '';

    const submit = async () => {
        setLoading(true);
        setError(null);
        setGif(null);
        setSourceImage(null);
        setImages([]);
        setPromptId(null);
        setAnimationPromptId(null);
        setIsPlaying(true);
        setGifKey(prev => prev + 1);

        try {
            const res = await fetch('/api/summon-ai-sprite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });

            let data: ApiResponse;
            try {
                data = await res.json();
            } catch (parseError) {
                const text = await res.text().catch(() => 'Unable to read response');
                setError(`Failed to parse response (${res.status}): ${text}`);
                return;
            }

            if (!res.ok || 'error' in data) {
                const reason = 'error' in data ? data.error : 'Request failed';
                const details = 'details' in data && data.details ? `: ${data.details}` : '';
                setError(`${reason}${details}`);
                return;
            }

            setPromptId(data.promptId);
            if (data.animationPromptId) {
                setAnimationPromptId(data.animationPromptId);
            }
            setGif(data.gif ?? null);
            setSourceImage(data.sourceImage ?? null);
            setImages(data.images ?? []);
            setIsPlaying(true);
            setGifKey(prev => prev + 1); // restart playback
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Unexpected error';
            // eslint-disable-next-line no-console
            console.error('Summon AI Sprite client error:', e);
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const cycleBubble = () => {
        const next = BUBBLE_LINES[Math.floor(Math.random() * BUBBLE_LINES.length)] ?? BUBBLE_LINES[0];
        setBubbleText(next);
    };

    return (
        <div className="min-h-screen bg-black">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <h1 className="text-xl font-semibold text-slate-900">Summon AI Sprite</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Enter a character description. We will generate a base sprite, animate it speaking, and show the resulting GIF.
                    </p>
                    <label className="mt-4 block text-sm font-medium text-slate-800" htmlFor="prompt">
                        Prompt
                    </label>
                    <textarea
                        id="prompt"
                        className="mt-2 w-full rounded border border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        rows={3}
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="Describe your character (e.g., A doctor)"
                    />
                    <div className="mt-3 flex items-center gap-3">
                        <button
                            type="button"
                            onClick={submit}
                            disabled={disabled}
                            className={`rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
                                disabled ? 'cursor-not-allowed opacity-60' : ''
                            }`}
                        >
                            {loading ? 'Summoning…' : 'Summon'}
                        </button>
                        {promptId ? (
                            <div className="flex flex-col gap-1 text-xs text-slate-600">
                                <span>Origin: {promptId}</span>
                                {animationPromptId ? <span>Animation: {animationPromptId}</span> : null}
                            </div>
                        ) : null}
                    </div>
                    {error ? <p className="mt-3 text-sm text-rose-600">Error: {error}</p> : null}
                </div>

                {/* GIF Player */}
                {(gif || sourceImage) && (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">Talking Sprite</h2>
                                <p className="text-sm text-slate-600">
                                    Play shows the GIF; Pause shows the still frame from the base sprite.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsPlaying(true);
                                        setGifKey(prev => prev + 1); // restart GIF when hitting play
                                    }}
                                    disabled={!gif}
                                    className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Play
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsPlaying(false)}
                                    disabled={!gif && !sourceImage}
                                    className="rounded bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Pause
                                </button>
                            </div>
                        </div>
                        <div className="mt-4 flex justify-center">
                            {displayUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={`${gifKey}-${isPlaying}`}
                                    src={displayUrl}
                                    alt={gif?.filename ?? sourceImage?.filename ?? 'Sprite animation'}
                                    className="max-h-[420px] max-w-full rounded border border-slate-200 bg-slate-50 object-contain"
                                />
                            ) : (
                                <div className="flex h-64 w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                                    No animation yet.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* All returned frames/media */}
                {images.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-900 mb-4">Returned Media</h2>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            {images.map((image, idx) => (
                                <div
                                    key={`media-${image.url}-${idx}`}
                                    className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                                >
                                    <div className="aspect-square bg-slate-50">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={image.url}
                                            alt={image.filename ?? `Media ${idx + 1}`}
                                            className="h-full w-full object-cover"
                                        />
                                    </div>
                                    <div className="p-3">
                                        <p className="text-xs font-medium text-slate-800">{image.filename ?? 'Image'}</p>
                                        {image.type ? (
                                            <p className="text-[11px] text-slate-500">
                                                {image.type}
                                                {image.subfolder ? ` · ${image.subfolder}` : ''}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Empty state */}
                {images.length === 0 && !gif && !sourceImage && !loading && (
                    <div className="col-span-full rounded border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                        No sprite yet. Submit a prompt to summon an AI sprite.
                    </div>
                )}
            </div>

            {/* Floating sub-assistant bubble (placeholder text for now) */}
            <div className="fixed bottom-6 right-6 z-50 flex items-end gap-3">
                <div className="max-w-xs rounded-2xl border border-white/30 bg-white/25 px-3 py-2 shadow-xl backdrop-blur-md">
                    <p className="text-[13px] leading-relaxed text-slate-800">{bubbleText}</p>
                    <button
                        type="button"
                        onClick={cycleBubble}
                        className="mt-2 rounded border border-white/40 bg-white/40 px-2.5 py-1 text-[11px] font-semibold text-slate-800 shadow-sm transition hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 focus:ring-offset-white/20"
                    >
                        Change line
                    </button>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <div className="h-32 w-32 overflow-hidden rounded-full bg-transparent shadow-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={gif?.url ?? sourceImage?.url ?? '/placeholder-avatar.png'}
                            alt="Sprite avatar"
                            className="h-full w-full object-contain bg-transparent"
                        />
                    </div>
                    <div className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm">
                        Listening (stub)
                    </div>
                </div>
            </div>
        </div>
    );
}

