"use client";

import React from "react";
import { WindowManagerProvider } from "../lib/WindowManagerContext";
import { SplitLayoutProvider } from "../lib/SplitLayoutContext";
import SplitScreenLayout from "./SplitScreenLayout";
import ChatMode from "../../ChatMode/components/ChatMode";

/**
 * SplitChatLayout
 *
 * Wraps ChatMode inside WindowManagerProvider + SplitScreenLayout so that
 * when a tool call opens a window (Notes, browser, etc.), the chat shrinks
 * to the left pane and the tool content renders on the right.
 *
 * Without this wrapper, ChatMode renders at z-[100] covering everything,
 * and tool windows are invisible behind it.
 */
const SplitChatLayout: React.FC = () => {
  return (
    <WindowManagerProvider>
      <SplitLayoutProvider value={true}>
        <SplitScreenLayout>
          <ChatMode />
        </SplitScreenLayout>
      </SplitLayoutProvider>
    </WindowManagerProvider>
  );
};

export default SplitChatLayout;
