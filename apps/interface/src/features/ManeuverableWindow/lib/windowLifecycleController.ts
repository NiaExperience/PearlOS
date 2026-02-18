/*
 * Centralized helpers for opening and closing multi-window apps.
 *
 * Components and event handlers should use these functions so that
 * BrowserWindow can process requests in a single place. This keeps
 * bot-triggered actions and direct UI interactions in sync.
 */

import type { ViewType, WindowInstance } from '../types/maneuverable-window-types';

export interface WindowOpenRequest {
  viewType: ViewType;
  viewState?: WindowInstance['viewState'];
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
  viewType?: ViewType;
  windowId?: string;
  reason?: string;
  options?: WindowCloseOptions;
  source?: string;
}

export const WINDOW_OPEN_EVENT = 'nia.window.open-request';
export const WINDOW_CLOSE_EVENT = 'nia.window.close-request';

function dispatchLifecycleEvent<TDetail>(eventName: string, detail: TDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TDetail>(eventName, { detail }));
}

export function requestWindowOpen(request: WindowOpenRequest) {
  dispatchLifecycleEvent(WINDOW_OPEN_EVENT, request);
}

export function requestWindowClose(request: WindowCloseRequest) {
  dispatchLifecycleEvent(WINDOW_CLOSE_EVENT, request);
}
