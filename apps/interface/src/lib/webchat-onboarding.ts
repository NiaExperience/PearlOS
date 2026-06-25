'use client';

import type { PanelKey } from '@interface/components/settings-panels/SettingsPanels';

import type { IPublicPersona } from '@nia/prism/core/blocks/userProfile.block';

export const WEBCHAT_ONBOARDING_PLACEHOLDER =
  'To talk, tap Pearl on the left. To type, enter "Hi!" here.';

export const PEARL_ONBOARDING_FIRST_REPLY_EVENT = 'pearl:onboarding:first-reply';
export const PEARL_ONBOARDING_PROFILE_SAVED_EVENT = 'pearl:onboarding:public-profile-saved';
export const PEARL_ONBOARDING_STATUS_EVENT = 'pearl:onboarding:status';
export const PEARL_ONBOARDING_CHAT_MESSAGE_EVENT = 'pearl:onboarding:chat-message';
export const PEARL_SETTINGS_OPEN_EVENT = 'pearl:settings-open';

const STORAGE_PREFIX = 'pearlos-webchat-onboarding-v1';

export type WebchatOnboardingStatus = 'idle' | 'started' | 'done';

export interface WebchatOnboardingFirstReplyDetail {
  source: 'text' | 'voice';
}

export interface WebchatOnboardingProfileSavedDetail {
  publicPersona: IPublicPersona;
}

export interface WebchatOnboardingStatusDetail {
  status: WebchatOnboardingStatus;
}

export interface WebchatOnboardingChatMessageDetail {
  message: string;
}

export interface PearlSettingsOpenDetail {
  panel: Exclude<PanelKey, null>;
}

export function onboardingStorageKey(userKey: string | null | undefined): string | null {
  if (!userKey) return null;
  return `${STORAGE_PREFIX}:${userKey}`;
}

export function readOnboardingStatus(userKey: string | null | undefined): WebchatOnboardingStatus {
  if (typeof window === 'undefined') return 'idle';
  const key = onboardingStorageKey(userKey);
  if (!key) return 'idle';
  const raw = window.localStorage.getItem(key);
  return raw === 'started' || raw === 'done' ? raw : 'idle';
}

export function writeOnboardingStatus(
  userKey: string | null | undefined,
  status: WebchatOnboardingStatus,
): void {
  if (typeof window === 'undefined') return;
  const key = onboardingStorageKey(userKey);
  if (!key) return;
  window.localStorage.setItem(key, status);
  window.dispatchEvent(
    new CustomEvent<WebchatOnboardingStatusDetail>(PEARL_ONBOARDING_STATUS_EVENT, {
      detail: { status },
    }),
  );
}

export function dispatchPearlOnboardingMessage(message: string): void {
  window.dispatchEvent(
    new CustomEvent<WebchatOnboardingChatMessageDetail>(PEARL_ONBOARDING_CHAT_MESSAGE_EVENT, {
      detail: { message },
    }),
  );
}

export function dispatchPearlSettingsOpen(panel: Exclude<PanelKey, null>): void {
  window.dispatchEvent(
    new CustomEvent<PearlSettingsOpenDetail>(PEARL_SETTINGS_OPEN_EVENT, {
      detail: { panel },
    }),
  );
}

export function compactPersonaSummary(publicPersona: IPublicPersona): string {
  const parts = [
    publicPersona.displayName ? `your name as ${publicPersona.displayName}` : null,
    publicPersona.profession ? `your work as ${publicPersona.profession}` : null,
    publicPersona.bio ? `that bio` : null,
    publicPersona.interests?.length ? `interests like ${publicPersona.interests.slice(0, 3).join(', ')}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'what you shared';
}

