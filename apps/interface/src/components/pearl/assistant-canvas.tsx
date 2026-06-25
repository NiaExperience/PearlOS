"use client";

import React from "react";
import { useVoiceSessionContext } from "@interface/contexts/voice-session-context";
import TileGifAvatar from "./tile-gif-avatar";

/**
 * AssistantCanvas — Main Pearl assistant display.
 *
 * Uses NIA bot events as the AUTHORITATIVE source for speaking state.
 * The `isAssistantSpeaking` value comes from VoiceSessionContext which
 * listens to `bot.speaking.started` / `bot.speaking.stopped` CustomEvents
 * dispatched by the NIA event router.
 *
 * This is the reference implementation. Video call tiles (Tile.tsx) should
 * follow the same pattern — NIA events first, audio-level fallback only
 * if NIA events are unavailable.
 */

interface AssistantCanvasProps {
  size?: number;
  className?: string;
}

const AssistantCanvas: React.FC<AssistantCanvasProps> = ({
  size = 200,
  className = "",
}) => {
  const { isAssistantSpeaking, isCallActive } = useVoiceSessionContext();

  if (!isCallActive) return null;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <TileGifAvatar
        isSpeaking={isAssistantSpeaking}
        size={size}
      />
    </div>
  );
};

export default AssistantCanvas;
