/**
 * Types for incremental OAuth authorization system
 */

import { Session } from "next-auth";

export interface ScopeRequest {
  scope: string;
  reason: string;
  required: boolean;
}

export interface IncrementalAuthConfig {
  clientId: string;
  baseUrl: string;
  scopes: ScopeRequest[];
  session?: Session; // Optional session for server-side auth
}

export interface AuthorizationResult {
  success: boolean;
  grantedScopes?: string[];
  deniedScopes?: string[];
  error?: string;
  newTokens?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    scope: string;
  };
}

export interface UserScopeStatus {
  userId: string;
  provider: string;
  grantedScopes: string[];
  requestedScopes: string[];
  lastUpdated: Date;
}

// Common Google API scopes
export const GOOGLE_SCOPES = {
  EMAIL: 'https://www.googleapis.com/auth/userinfo.email',
  PROFILE: 'https://www.googleapis.com/auth/userinfo.profile',
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
  GMAIL_COMPOSE: 'https://www.googleapis.com/auth/gmail.compose',
  GMAIL_MODIFY: 'https://www.googleapis.com/auth/gmail.modify',
  GMAIL_SEND: 'https://www.googleapis.com/auth/gmail.send',
  DRIVE_READONLY: 'https://www.googleapis.com/auth/drive.readonly',
  DRIVE_FILE: 'https://www.googleapis.com/auth/drive.file',
  DRIVE_FULL: 'https://www.googleapis.com/auth/drive',
  CALENDAR_READONLY: 'https://www.googleapis.com/auth/calendar.readonly',
  CALENDAR_EVENTS: 'https://www.googleapis.com/auth/calendar.events',
  CALENDAR_FULL: 'https://www.googleapis.com/auth/calendar',
  YOUTUBE_READONLY: 'https://www.googleapis.com/auth/youtube.readonly',
  CONTACTS_READONLY: 'https://www.googleapis.com/auth/contacts.readonly',
  PHOTOS_READONLY: 'https://www.googleapis.com/auth/photoslibrary.readonly',
} as const;

export type GoogleScope = typeof GOOGLE_SCOPES[keyof typeof GOOGLE_SCOPES];
