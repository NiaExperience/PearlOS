"use client";

import React, { useState, useEffect, useRef } from "react";

// ── GIF asset paths ──
const AVATAR_GIFS = {
  sleep: "/images/avatar/Pearlinactivenew.png",
  waking: "/images/avatar/StarupPearl.gif",
  idle: "/images/avatar/pearlIdle1.gif",
  sleeping: "/images/avatar/PearlShutdown.gif",
} as const;

// Alternate idle GIFs for variety
const IDLE_GIFS = [
  "/images/avatar/pearlIdle1.gif",
  "/images/avatar/Pearlidle2.gif",
];

// Talking GIFs — cycled with cache-busting so non-looping GIFs replay
const TALKING_GIFS = [
  "/images/avatar/avatar-talking.gif",
  "/images/avatar/PearlTalking1.gif",
];

type AvatarState = "sleep" | "waking" | "idle" | "talking" | "sleeping";

// Durations for one-shot GIF animations (ms)
const WAKING_DURATION = 2500;
const SLEEPING_DURATION = 2000;

interface PearlAvatarProps {
  /** Whether the avatar should be "awake" (voice call active) */
  isAwake: boolean;
  /** Whether the assistant is currently speaking/typing */
  isTalking: boolean;
  /** Size in px */
  size?: number;
  /** Click handler */
  onClick?: () => void;
  /** Additional className */
  className?: string;
}

const PearlAvatar: React.FC<PearlAvatarProps> = ({
  isAwake,
  isTalking,
  size = 57,
  onClick,
  className = "",
}) => {
  const [state, setState] = useState<AvatarState>("sleep");
  const [idleIndex, setIdleIndex] = useState(0);
  const [talkingIndex, setTalkingIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const talkingCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (idleCycleRef.current) clearInterval(idleCycleRef.current);
      if (talkingCycleRef.current) clearInterval(talkingCycleRef.current);
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
    } else if (!isAwake && state !== "sleep" && state !== "sleeping") {
      if (timerRef.current) clearTimeout(timerRef.current);

      setState("sleeping");
      timerRef.current = setTimeout(() => {
        setState("sleep");
      }, SLEEPING_DURATION);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAwake]); // intentionally only depend on isAwake

  // ── Idle/Talking transitions (only when fully awake) ──
  useEffect(() => {
    if (state === "idle" && isTalking) {
      setState("talking");
    } else if (state === "talking" && !isTalking) {
      setState("idle");
    }
  }, [isTalking, state]);

  // Safety timeout: if stuck in talking state for >30s, force back to idle
  const talkingSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state === "talking") {
      talkingSafetyRef.current = setTimeout(() => {
        setState("idle");
      }, 30000);
      return () => {
        if (talkingSafetyRef.current) clearTimeout(talkingSafetyRef.current);
      };
    }
  }, [state]);

  // ── Cycle idle GIFs every 4 seconds when idle ──
  // Uses a cache-bust timestamp so non-looping GIFs replay from frame 1
  const [idleCacheBust, setIdleCacheBust] = useState(0);
  useEffect(() => {
    if (state === "idle") {
      // Force initial GIF to replay when entering idle state
      setIdleCacheBust(Date.now());
      idleCycleRef.current = setInterval(() => {
        setIdleIndex(prev => (prev + 1) % IDLE_GIFS.length);
        setIdleCacheBust(Date.now());
      }, 4000);
      return () => {
        if (idleCycleRef.current) clearInterval(idleCycleRef.current);
      };
    }
  }, [state]);

  // ── Cycle talking GIFs every 3 seconds when talking ──
  // Uses a cache-bust timestamp so non-looping GIFs replay from frame 1
  // This ensures continuous animation throughout Pearl's entire speech
  const [talkingCacheBust, setTalkingCacheBust] = useState(0);
  useEffect(() => {
    if (state === "talking") {
      // Force initial GIF to replay when entering talking state
      setTalkingCacheBust(Date.now());
      talkingCycleRef.current = setInterval(() => {
        setTalkingIndex(prev => {
          let next;
          do {
            next = Math.floor(Math.random() * TALKING_GIFS.length);
          } while (TALKING_GIFS.length > 1 && next === prev);
          return next;
        });
        setTalkingCacheBust(Date.now());
      }, 2500 + Math.random() * 1500); // Randomized interval for natural feel
      return () => {
        if (talkingCycleRef.current) clearInterval(talkingCycleRef.current);
      };
    }
  }, [state]);

  // Resolve the current GIF source
  let src: string;
  if (state === "waking" || state === "sleeping") {
    // Cache-bust one-shot GIFs so they replay from the start
    src = `${AVATAR_GIFS[state]}?t=${Date.now()}`;
  } else if (state === "idle") {
    src = `${IDLE_GIFS[idleIndex]}?t=${idleCacheBust}`;
  } else if (state === "talking") {
    src = `${TALKING_GIFS[talkingIndex]}?t=${talkingCacheBust}`;
  } else {
    src = AVATAR_GIFS[state];
  }

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
      }}
      onError={(e) => {
        (e.target as HTMLImageElement).src = "/images/pearl-avatar.png";
      }}
    />
  );
};

export default PearlAvatar;
