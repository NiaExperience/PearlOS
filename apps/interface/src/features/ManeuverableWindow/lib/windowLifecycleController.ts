/*
 * Centralized helpers for opening and closing multi-window apps.
 *
 * Components and event handlers should use these functions so that
 * BrowserWindow can process requests in a single place. This keeps
 * bot-triggered actions and direct UI interactions in sync.
 */

import type { ViewType, WindowInstance } from '../types/maneuverable-window-types';

export type { ViewType } from '../types/maneuverable-window-types';

export interface WindowOpenRequest {
  viewType: ViewType;
  viewState?: WindowInstance['viewState'];
  title?: string;
  url?: string;
  html?: string;
  slot?: 'left' | 'right' | 'center' | 'float';
  widthFraction?: number;
  heightFraction?: number;
  meta?: Record<string, unknown>;
  options?: {
    allowDuplicate?: boolean;
    resourceId?: string;
    resourceTitle?: string;
  };
  source?: string;
}

export interface WindowCloseOptions {
  allowNotesDelegate?: boolean;
  fallbackToCloseAll?: boolean;
  suppressStandaloneReset?: boolean;
}

export interface WindowCloseRequest {
  all?: boolean;
  viewType?: ViewType;
  windowId?: string;
  reason?: string;
  options?: WindowCloseOptions;
  source?: string;
}

export interface WindowFocusRequest {
  windowId: string;
  source?: string;
}

export const WINDOW_OPEN_EVENT = 'nia.window.open-request';
export const WINDOW_CLOSE_EVENT = 'nia.window.close-request';
export const WINDOW_FOCUS_EVENT = 'nia.window.focus-request';

/** Set by BrowserWindow when its lifecycle listeners are attached. */
let browserWindowLifecycleReady = false;
const pendingOpenRequests: WindowOpenRequest[] = [];

function dispatchLifecycleEvent<TDetail>(eventName: string, detail: TDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TDetail>(eventName, { detail }));
}

/**
 * BrowserWindow calls this when mounting (and clearing on unmount) so early
 * requestWindowOpen calls — e.g. URL deep links — are not lost.
 */
export function setBrowserWindowLifecycleReady(ready: boolean) {
  browserWindowLifecycleReady = ready;
  if (!ready || typeof window === 'undefined') return;
  const batch = pendingOpenRequests.splice(0);
  for (const request of batch) {
    dispatchLifecycleEvent(WINDOW_OPEN_EVENT, request);
  }
}

export function isBrowserWindowLifecycleReady(): boolean {
  return browserWindowLifecycleReady;
}

export function requestWindowOpen(request: WindowOpenRequest) {
  if (typeof window === 'undefined') return;
  if (!browserWindowLifecycleReady) {
    pendingOpenRequests.push(request);
    return;
  }
  dispatchLifecycleEvent(WINDOW_OPEN_EVENT, request);
}

export function requestWindowClose(request: WindowCloseRequest) {
  dispatchLifecycleEvent(WINDOW_CLOSE_EVENT, request);
}
