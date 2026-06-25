"use client";

import { createContext, useContext } from "react";

/**
 * When true, the consumer is rendered inside a SplitScreenLayout pane.
 * ChatMode uses this to switch from fixed to absolute positioning so it
 * stays contained within its pane instead of covering the full viewport.
 */
const SplitLayoutContext = createContext(false);

export const SplitLayoutProvider = SplitLayoutContext.Provider;
export const useIsInSplitLayout = () => useContext(SplitLayoutContext);
