"use client";

import React, { useState, useEffect, useRef } from "react";

// ── GIF asset paths ──
const PEARL_ANIMATION_BASE = "/images/avatar/pearl-animation-gifs/optimized";
const PEARL_IDLE_GIFS = [
  `${PEARL_ANIMATION_BASE}/PearlIdle1.gif`,
  `${PEARL_ANIMATION_BASE}/PearlIdle2.gif`,
] as const;
const PEARL_TALKING_GIFS = [
  `${PEARL_ANIMATION_BASE}/PearlTalk1.gif`,
  `${PEARL_ANIMATION_BASE}/PearlTalk2.gif`,
] as const;

const AVATAR_GIFS = {
  sleep: "/images/avatar/Pearlinactivenew.png",
  waking: "/images/avatar/StarupPearl.gif",
  idle: PEARL_IDLE_GIFS[0],
  talking: PEARL_TALKING_GIFS[0],
  sleeping: "/images/avatar/PearlShutdown.gif",
} as const;

type AvatarState = "sleep" | "waking" | "idle" | "talking" | "sleeping";

const WAKING_DURATION = 1300;
const SLEEPING_DURATION = 1100;
const PRELOAD_SOURCES = [
  ...PEARL_IDLE_GIFS,
  ...PEARL_TALKING_GIFS,
  AVATAR_GIFS.waking,
  AVATAR_GIFS.sleeping,
] as const;

interface PearlAvatarProps {
  /** Whether the avatar should be "awake" (chat mode active or voice call active) */
  isAwake: boolean;
  /** Whether the assistant is currently speaking/typing */
  isTalking: boolean;
  /** Size in px */
  size?: number;
  /** Click handler */
  onClick?: () => void;
  /** Additional className */
  className?: string;
  /** Keep the current still frame while a voice session is connecting. */
  freezeIdle?: boolean;
  /** Inline style overrides for callers that need precise placement. */
  style?: React.CSSProperties;
}

const PearlAvatar: React.FC<PearlAvatarProps> = ({
  isAwake,
  isTalking,
  size = 30,
  onClick,
  className = "",
  freezeIdle = false,
  style,
}) => {
  const [state, setState] = useState<AvatarState>("sleep");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleGifRef = useRef(PEARL_IDLE_GIFS[Math.floor(Math.random() * PEARL_IDLE_GIFS.length)]);
  const talkingGifRef = useRef(PEARL_TALKING_GIFS[Math.floor(Math.random() * PEARL_TALKING_GIFS.length)]);

  useEffect(() => {
    PRELOAD_SOURCES.forEach((source) => {
      const image = new Image();
      image.src = source;
    });
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ── Wake/Sleep transitions ──
  useEffect(() => {
    if (isAwake && (state === "sleep" || state === "sleeping")) {
      // Cancel any pending sleep timer
      if (timerRef.current) clearTimeout(timerRef.current);

      setState("waking");
      timerRef.current = setTimeout(() => {
        setState(isTalking ? "talking" : "idle");
      }, WAKING_DURATION);
    } else if (!isAwake && state !== "sleep" && state !== "sleeping" && state !== "waking") {
      if (timerRef.current) clearTimeout(timerRef.current);

      setState("sleeping");
      timerRef.current = setTimeout(() => {
        setState("sleep");
      }, SLEEPING_DURATION);
    }
  }, [isAwake]); // intentionally only depend on isAwake

  // ── Idle/Talking transitions (only when fully awake) ──
  useEffect(() => {
    if (state === "idle" && isTalking) {
      setState("talking");
    } else if (state === "talking" && !isTalking) {
      setState("idle");
    }
  }, [isTalking, state]);

  // Force-reload GIF on one-shot animations by appending cache-buster
  const effectiveState = freezeIdle && state !== "sleep" ? "idle" : state;
  const stateSrc =
    effectiveState === "idle" ? idleGifRef.current :
    effectiveState === "talking" ? talkingGifRef.current :
    AVATAR_GIFS[effectiveState];
  const src = (effectiveState === "waking" || effectiveState === "sleeping")
    ? `${stateSrc}?t=${Date.now()}`
    : stateSrc;

  return (
    <img
      src={src}
      alt="Pearl"
      onClick={onClick}
      className={`shrink-0 rounded-full cursor-pointer ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: "cover",
        opacity: state === "sleep" ? 0.6 : 1,
        transition: "opacity 0.3s ease",
        ...style,
      }}
      onError={(e) => {
        (e.target as HTMLImageElement).src = "/images/pearl-avatar.png";
      }}
    />
  );
};

// memo'd so unrelated parent re-renders (e.g. ChatMode on every keystroke)
// don't re-evaluate the GIF <img> tree.
export default React.memo(PearlAvatar);
