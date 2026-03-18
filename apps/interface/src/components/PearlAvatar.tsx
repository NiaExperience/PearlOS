"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const AVATAR_ASSETS = {
  sleep: "/images/avatar/Pearlinactivenew.png",
  waking: "/images/avatar/StarupPearl.gif",
  sleeping: "/images/avatar/PearlShutdown.gif",
} as const;

const IDLE_GIFS = ["/images/avatar/pearlIdle1.gif", "/images/avatar/Pearlidle2.gif"];
const TALKING_GIFS = ["/images/avatar/avatar-talking.gif", "/images/avatar/PearlTalking1.gif"];

const WAKING_DURATION_MS = 1200;
const SLEEPING_DURATION_MS = 1000;
const IDLE_CYCLE_MS = 4000;
const TALKING_CYCLE_MS = 2800;

export type PearlAvatarState = "sleep" | "waking" | "idle" | "talking" | "sleeping";

interface PearlAvatarProps {
  isAwake: boolean;
  isTalking: boolean;
  size?: number;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  freezeIdle?: boolean;
  onTransitionLockChange?: (locked: boolean) => void;
  onAnimationStateChange?: (state: PearlAvatarState) => void;
}

const PearlAvatar: React.FC<PearlAvatarProps> = ({
  isAwake,
  isTalking,
  size = 57,
  onClick,
  className = "",
  style: styleProp,
  freezeIdle = false,
  onTransitionLockChange,
  onAnimationStateChange,
}) => {
  const [state, setState] = useState<PearlAvatarState>("sleep");
  const [isTransitionLocked, setIsTransitionLocked] = useState(false);
  const [idleIndex, setIdleIndex] = useState(0);
  const [talkingIndex, setTalkingIndex] = useState(0);
  const [displayedSrc, setDisplayedSrc] = useState<string>(AVATAR_ASSETS.sleep);

  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleCycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const talkingCycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const oneShotCacheBustRef = useRef<number>(Date.now());

  const clearTransitionTimer = () => {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  };

  useEffect(() => {
    [AVATAR_ASSETS.sleep, AVATAR_ASSETS.waking, AVATAR_ASSETS.sleeping, ...IDLE_GIFS, ...TALKING_GIFS].forEach((asset) => {
      const img = new Image();
      img.src = asset;
    });
    return () => {
      clearTransitionTimer();
      if (idleCycleTimerRef.current) clearInterval(idleCycleTimerRef.current);
      if (talkingCycleTimerRef.current) clearInterval(talkingCycleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    onTransitionLockChange?.(isTransitionLocked);
  }, [isTransitionLocked, onTransitionLockChange]);

  useEffect(() => {
    onAnimationStateChange?.(state);
  }, [state, onAnimationStateChange]);

  useEffect(() => {
    if (isAwake && (state === "sleep" || state === "sleeping")) {
      clearTransitionTimer();
      oneShotCacheBustRef.current = Date.now();
      setIsTransitionLocked(true);
      setState("waking");
      transitionTimerRef.current = setTimeout(() => {
        setIsTransitionLocked(false);
        setState(isTalking ? "talking" : "idle");
      }, WAKING_DURATION_MS);
      return;
    }

    if (!isAwake && state !== "sleep" && state !== "sleeping") {
      clearTransitionTimer();
      oneShotCacheBustRef.current = Date.now();
      setIsTransitionLocked(true);
      setState("sleeping");
      transitionTimerRef.current = setTimeout(() => {
        setIsTransitionLocked(false);
        setState("sleep");
      }, SLEEPING_DURATION_MS);
    }
  }, [isAwake, isTalking, state]);

  useEffect(() => {
    if (!isAwake || isTransitionLocked) return;
    if (state === "idle" && isTalking) {
      setState("talking");
    } else if (state === "talking" && !isTalking) {
      setState("idle");
    }
  }, [isAwake, isTalking, isTransitionLocked, state]);

  useEffect(() => {
    if (idleCycleTimerRef.current) {
      clearInterval(idleCycleTimerRef.current);
      idleCycleTimerRef.current = null;
    }
    if (state !== "idle" || freezeIdle) return;
    idleCycleTimerRef.current = setInterval(() => {
      setIdleIndex((prev) => (prev + 1) % IDLE_GIFS.length);
    }, IDLE_CYCLE_MS);
    return () => {
      if (idleCycleTimerRef.current) {
        clearInterval(idleCycleTimerRef.current);
        idleCycleTimerRef.current = null;
      }
    };
  }, [state, freezeIdle]);

  useEffect(() => {
    if (talkingCycleTimerRef.current) {
      clearInterval(talkingCycleTimerRef.current);
      talkingCycleTimerRef.current = null;
    }
    if (state !== "talking") return;
    talkingCycleTimerRef.current = setInterval(() => {
      setTalkingIndex((prev) => (prev + 1) % TALKING_GIFS.length);
    }, TALKING_CYCLE_MS);
    return () => {
      if (talkingCycleTimerRef.current) {
        clearInterval(talkingCycleTimerRef.current);
        talkingCycleTimerRef.current = null;
      }
    };
  }, [state]);

  const src = useMemo(() => {
    if (state === "waking" || state === "sleeping") {
      return `${AVATAR_ASSETS[state]}?t=${oneShotCacheBustRef.current}`;
    }
    if (state === "talking") {
      return TALKING_GIFS[talkingIndex];
    }
    if (state === "idle") {
      return freezeIdle ? IDLE_GIFS[0] : IDLE_GIFS[idleIndex];
    }
    return AVATAR_ASSETS.sleep;
  }, [state, talkingIndex, idleIndex, freezeIdle]);

  // Swap image source only after target asset is loaded to avoid visual flashes
  // and avoid showing any fallback layer "behind" transparent GIF frames.
  useEffect(() => {
    if (displayedSrc === src) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setDisplayedSrc(src);
    };
    img.onerror = () => {
      if (!cancelled) setDisplayedSrc(AVATAR_ASSETS.sleep);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, displayedSrc]);

  return (
    <img
      src={displayedSrc}
      alt="Pearl"
      data-pearl-state={state}
      data-pearl-awake={String(isAwake)}
      data-pearl-locked={String(isTransitionLocked)}
      onClick={() => {
        if (!isTransitionLocked) onClick?.();
      }}
      className={`shrink-0 rounded-full ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: "cover",
        opacity: state === "sleep" ? 0.45 : state === "sleeping" ? 0.7 : 1,
        transition: "opacity 220ms ease",
        ...styleProp,
      }}
      onError={(e) => {
        (e.target as HTMLImageElement).src = "/images/avatar/Pearlinactivenew.png";
      }}
    />
  );
};

export default PearlAvatar;
