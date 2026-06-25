"use client";

import React, { useMemo, useEffect, useRef } from "react";
import { useVoiceSessionContext } from "@interface/contexts/voice-session-context";
import { useAudioSpeakingDetection } from "@interface/hooks/useAudioSpeakingDetection";
import TileGifAvatar from "@interface/components/pearl/tile-gif-avatar";

/**
 * Tile — Video call tile for Daily.co integration.
 *
 * ## Lip Sync Fix v3: Audio-level analysis as authoritative source
 *
 * Root cause of persistent lip sync bugs: NIA bot events
 * (`bot.speaking.started`/`bot.speaking.stopped`) fire based on the bot's
 * *intent* to speak (server-side TTS generation), NOT when audio actually
 * plays through the user's speakers. This causes:
 *   - Avatar animates before audio starts (event fires early)
 *   - Avatar stops before audio finishes (event fires early)
 *   - Avatar animates when no audio plays (event fires but audio fails)
 *   - Avatar doesn't animate when audio plays (events never dispatched)
 *
 * Fix: Use Web Audio API AnalyserNode on the actual bot audio track as the
 * PRIMARY and AUTHORITATIVE source. Falls back to NIA events only when no
 * audio track is available (shouldn't happen in normal Daily.co calls).
 *
 * The `useAudioSpeakingDetection` hook uses hysteresis thresholds and a
 * short debounce to produce stable, flicker-free speaking state that is
 * perfectly synchronized with what the user actually hears.
 */

interface TileProps {
  /** Participant ID */
  participantId: string;
  /** Whether this tile is the bot/assistant */
  isBot?: boolean;
  /** Whether this tile's participant is the local user */
  isLocal?: boolean;
  /** Video track element */
  videoTrack?: MediaStreamTrack | null;
  /** Audio track for speaking detection */
  audioTrack?: MediaStreamTrack | null;
  /** Whether the user is currently speaking (for user tile visual) */
  isUserSpeaking?: boolean;
  /** Human-readable participant label */
  displayName?: string;
  /** Additional className */
  className?: string;
  /** Optional tile activation handler */
  onClick?: () => void;
}

const Tile: React.FC<TileProps> = ({
  participantId,
  isBot = false,
  isLocal = false,
  videoTrack,
  audioTrack,
  isUserSpeaking = false,
  displayName,
  className = "",
  onClick,
}) => {
  const { isAssistantSpeaking, setAudioSpeakingState } = useVoiceSessionContext();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Audio-level analysis of the actual bot audio output (authoritative)
  const audioDetection = useAudioSpeakingDetection(isBot ? audioTrack : null);

  // Feed audio detection back into context so other consumers
  // (e.g., AssistantCanvas) also get the authoritative signal.
  // IMPORTANT: Only trigger on isSpeaking changes — NOT on every volumeLevel
  // change, which would cause 4fps re-renders of the entire context tree.
  useEffect(() => {
    if (isBot && audioTrack) {
      setAudioSpeakingState(audioDetection.isSpeaking, audioDetection.volumeLevel);
    }
  }, [isBot, audioTrack, audioDetection.isSpeaking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Primary: actual audio output analysis (what the user hears)
  // Fallback: NIA bot events (only if no audio track available)
  const isBotSpeaking = audioTrack
    ? audioDetection.isSpeaking
    : isAssistantSpeaking;

  // For non-bot tiles, show user speaking indicator
  const tileIsSpeaking = isBot ? isBotSpeaking : isUserSpeaking;

  // Memoize speaking ring style
  const speakingRingStyle = useMemo(() => ({
    boxShadow: tileIsSpeaking
      ? "0 0 0 3px rgba(217, 79, 142, 0.6), 0 0 12px rgba(217, 79, 142, 0.3)"
      : "none",
    transition: "box-shadow 0.2s ease",
  }), [tileIsSpeaking]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (videoTrack) {
      video.srcObject = new MediaStream([videoTrack]);
      return;
    }

    video.srcObject = null;
  }, [videoTrack]);

  const participantLabel = displayName || (isBot ? "Pearl" : isLocal ? "You" : participantId);
  const testId = isBot
    ? "pearl-vision-bot-tile"
    : isLocal
      ? "daily-call-local-tile"
      : "daily-call-participant-tile";
  const initials = (participantLabel || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("") || "?";

  return (
    <div
      className={[
        "tile-container",
        isBot ? "pearl-bot" : "",
        isLocal ? "local-participant" : "remote-participant",
        videoTrack ? "has-video" : "no-video",
        tileIsSpeaking ? "speaking" : "",
        className,
      ].filter(Boolean).join(" ")}
      data-testid={testId}
      data-participant-id={participantId}
      aria-label={isBot ? "Pearl is visible in the call" : `${participantLabel} call tile`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      style={speakingRingStyle}
    >
      {videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="tile-video"
        />
      ) : isBot ? (
        <div className="absolute inset-0 flex items-center justify-center" data-testid="pearl-vision-avatar">
          <TileGifAvatar
            isSpeaking={isBotSpeaking}
            size={120}
          />
        </div>
      ) : (
        <div className="placeholder-video" data-testid="daily-call-video-placeholder">
          <div className="avatar-placeholder" aria-hidden="true">{initials}</div>
        </div>
      )}

      <div
        className={[
          "username-label",
          "visible",
          isBot ? "pearl-bot-label" : "",
          tileIsSpeaking ? "speaking-label" : "",
        ].filter(Boolean).join(" ")}
      >
        {participantLabel}
      </div>
    </div>
  );
};

export default Tile;
