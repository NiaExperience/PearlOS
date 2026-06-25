"use client";

import { Search } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { WindowLayout } from '../types/maneuverable-window-types';

interface ControlsProps {
    layout: WindowLayout;
    onLayoutChange: (layout: WindowLayout) => void;
    onMinimize: () => void;
    onClose: () => void;
    onRestoreCenter: () => void;
    /** Show compact YouTube search under the close control (browser window wires this when YouTube is open). */
    showYoutubeSearch?: boolean;
    /** Current query from window state (keeps input in sync when search changes elsewhere). */
    youtubeSearchQuery?: string | null;
    onYoutubeSearchSubmit?: (query: string) => void;
}

export function ManeuverableWindowControls({
    onClose,
    showYoutubeSearch,
    youtubeSearchQuery,
    onYoutubeSearchSubmit,
}: ControlsProps) {
    const [draft, setDraft] = useState('');
    const [searchExpanded, setSearchExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const youtubeSearchRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setDraft(youtubeSearchQuery ?? '');
    }, [youtubeSearchQuery]);

    useEffect(() => {
        if (!searchExpanded) return;
        const t = window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => window.clearTimeout(t);
    }, [searchExpanded]);

    useEffect(() => {
        if (!searchExpanded) return;
        const onPointerDown = (e: PointerEvent) => {
            const el = youtubeSearchRef.current;
            if (el && !el.contains(e.target as Node)) {
                setSearchExpanded(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSearchExpanded(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [searchExpanded]);

    const submitSearch = (e?: React.FormEvent) => {
        e?.preventDefault();
        e?.stopPropagation();
        const q = draft.trim();
        if (!q || !onYoutubeSearchSubmit) return;
        onYoutubeSearchSubmit(q);
        setSearchExpanded(false);
    };

    const searchIconButtonClass =
        'pearl-app-window-control flex h-9 w-9 shrink-0 items-center justify-center rounded-full border p-0 transition-all active:scale-95';

    return (
        <div className="absolute top-2.5 right-4 z-[300] flex flex-col items-end gap-2">
            <button
                type="button"
                onClick={onClose}
                className="pearl-app-window-control flex h-9 w-9 shrink-0 items-center justify-center rounded-full border p-0 text-base font-semibold leading-none transition-all active:scale-95"
                title="Close"
                aria-label="Close window"
            >
                ✕
            </button>

            {showYoutubeSearch && onYoutubeSearchSubmit ? (
                <div ref={youtubeSearchRef} className="flex flex-col items-end">
                    {!searchExpanded ? (
                        <button
                            type="button"
                            className={searchIconButtonClass}
                            title="Search YouTube"
                            aria-label="Open YouTube search"
                            aria-expanded={false}
                            aria-controls="youtube-window-search-field"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSearchExpanded(true);
                            }}
                        >
                            <Search className="h-4 w-4" strokeWidth={2} />
                        </button>
                    ) : (
                        <form
                            id="youtube-window-search-form"
                            onSubmit={submitSearch}
                            className="pearl-app-window-control flex max-w-[min(18rem,calc(100vw-5rem))] origin-top-right animate-in fade-in zoom-in-95 duration-150 items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 shadow-lg sm:max-w-none sm:w-48"
                            aria-label="Search YouTube"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <input
                                ref={inputRef}
                                id="youtube-window-search-field"
                                data-yt-window-search
                                type="text"
                                inputMode="search"
                                enterKeyHint="search"
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder="Search YouTube…"
                                className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-xs text-[var(--pearl-text)] shadow-none outline-none ring-0 placeholder:text-[var(--pearl-muted)] focus:ring-0"
                                aria-label="YouTube search"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                            />
                            <button
                                type="submit"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--pearl-text)] transition-colors hover:bg-[var(--pearl-window-control-hover-bg)] active:scale-95 sm:h-7 sm:w-7"
                                title="Search"
                                aria-label="Search YouTube"
                            >
                                <Search className="h-4 w-4" strokeWidth={2} />
                            </button>
                        </form>
                    )}
                </div>
            ) : null}
        </div>
    );
}
