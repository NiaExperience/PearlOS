"use client";

import React from "react";
import { useVoiceSessionContext } from "@interface/contexts/voice-session-context";
import PearlAvatar from "@interface/components/PearlAvatar";

const AVATAR_SIZE = 96;

const CenterScreenAvatar: React.FC = () => {
  const { callStatus, isAssistantSpeaking } = useVoiceSessionContext();
  const isCallActive = callStatus === "active";

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 50,
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        pointerEvents: "none",
      }}
    >
      <PearlAvatar
        isAwake={isCallActive}
        isTalking={isAssistantSpeaking}
        size={AVATAR_SIZE}
        className="w-full h-full object-cover rounded-full"
      />
    </div>
  );
};

export default CenterScreenAvatar;
