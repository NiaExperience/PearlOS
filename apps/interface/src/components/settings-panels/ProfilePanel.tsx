'use client';

import { useEffect, useState } from 'react';

import { Button } from '@interface/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { Label } from '@interface/components/ui/label';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import {
  PEARL_ONBOARDING_PROFILE_SAVED_EVENT,
  readOnboardingStatus,
  type WebchatOnboardingProfileSavedDetail,
} from '@interface/lib/webchat-onboarding';

import { useUserProfileMetadata } from './useUserProfileMetadata';

import type { IPrivateMemory, IPublicPersona } from '@nia/prism/core/blocks/userProfile.block';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;
const PRIVATE_PROFILE_TEXT_KEY = 'privateProfileText';

function privateProfileText(memory: IPrivateMemory | null): string {
  const sensitive = memory?.sensitiveData;
  const value = sensitive && typeof sensitive === 'object' ? sensitive[PRIVATE_PROFILE_TEXT_KEY] : '';
  if (typeof value === 'string') return value;
  return '';
}

interface ProfilePanelProps {
  tenantId?: string;
  buildName: string;
  commitSha: string;
}

type ProfilePane = 'public' | 'private';

export function ProfilePanel({ tenantId, buildName, commitSha }: ProfilePanelProps) {
  const { data: session } = useResilientSession();
  const {
    publicPersona,
    privateMemory,
    userProfileId,
    loading,
    error,
    refresh,
  } = useUserProfileMetadata(true, tenantId);
  const [publicText, setPublicText] = useState('');
  const [privateText, setPrivateText] = useState('');
  const [activePane, setActivePane] = useState<ProfilePane>('public');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const user = session?.user;
  const userKey = user?.id || user?.email || null;

  useEffect(() => {
    setPublicText(publicPersona?.bio || '');
  }, [publicPersona]);

  useEffect(() => {
    setPrivateText(privateProfileText(privateMemory));
  }, [privateMemory]);

  const saveProfile = async () => {
    if (!userProfileId || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const publicPayload: IPublicPersona = {
        ...(publicPersona || {}),
        bio: publicText.trim(),
        isPublic: publicText.trim().length > 0,
      };
      const currentSensitive =
        privateMemory?.sensitiveData && typeof privateMemory.sensitiveData === 'object'
          ? privateMemory.sensitiveData
          : {};
      const privatePayload: IPrivateMemory = {
        ...(privateMemory || {}),
        sensitiveData: {
          ...currentSensitive,
          [PRIVATE_PROFILE_TEXT_KEY]: privateText.trim(),
        },
      };

      const response = await fetch('/api/userProfile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userProfileId,
          publicPersona: publicPayload,
          privateMemory: privatePayload,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save profile');
      }
      await refresh();
      if (readOnboardingStatus(userKey) === 'started') {
        window.dispatchEvent(
          new CustomEvent<WebchatOnboardingProfileSavedDetail>(PEARL_ONBOARDING_PROFILE_SAVED_EVENT, {
            detail: { publicPersona: publicPayload },
          }),
        );
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setLoggingOut(true);
    try {
      const current = typeof window !== 'undefined' ? window.location.href : '/';
      const res = await fetch(`/api/auth/signout?callbackUrl=${encodeURIComponent(current)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string };
      window.location.replace(data.redirect || '/login');
    } catch {
      window.location.replace('/login');
    }
  };

  return (
    <Card className="border-gray-700 bg-gray-800" style={FONT}>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-white" style={FONT}>Profile</CardTitle>
            <div className="mt-2 space-y-1 text-sm">
              <div className="truncate text-gray-100">{user?.name || 'Signed in user'}</div>
              {user?.email ? <div className="truncate text-xs text-gray-400">{user.email}</div> : null}
            </div>
          </div>
          <Button
            type="button"
            onClick={signOut}
            disabled={loggingOut}
            className="shrink-0 bg-red-600 text-white hover:bg-red-700"
            style={FONT}
          >
            {loggingOut ? 'Signing out...' : 'Sign Out'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5" style={FONT}>
        {loading ? (
          <div className="py-8 text-center text-sm text-blue-300">Loading profile...</div>
        ) : error ? (
          <div className="rounded-md border border-red-600 bg-red-900/20 p-3 text-sm text-red-300">
            {error}
          </div>
        ) : (
          <>
            <div
              className="grid grid-cols-2 overflow-hidden rounded-md border border-gray-600 bg-gray-950 p-1"
              role="tablist"
              aria-label="Profile data view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activePane === 'public'}
                onClick={() => setActivePane('public')}
                className={`h-10 rounded-sm px-3 text-sm transition ${
                  activePane === 'public'
                    ? 'bg-emerald-700 text-white'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
                style={FONT}
              >
                Public
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePane === 'private'}
                onClick={() => setActivePane('private')}
                className={`h-10 rounded-sm px-3 text-sm transition ${
                  activePane === 'private'
                    ? 'bg-amber-700 text-white'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
                style={FONT}
              >
                Private
              </button>
            </div>

            {activePane === 'public' ? (
              <section className="space-y-3 rounded-md border border-emerald-600/70 bg-emerald-950/25 p-4">
                <div>
                  <Label htmlFor="pearl-public-profile-text" className="text-emerald-100" style={FONT}>
                    Public profile
                  </Label>
                </div>
                <textarea
                  id="pearl-public-profile-text"
                  value={publicText}
                  onChange={(event) => setPublicText(event.target.value)}
                  className="min-h-[150px] w-full resize-none rounded-md border border-emerald-700 bg-gray-950 p-3 text-sm leading-5 text-white outline-none focus:border-emerald-400"
                  style={FONT}
                  placeholder="What should other PearlOS users know about you?"
                />
              </section>
            ) : (
              <section className="space-y-3 rounded-md border border-amber-600/70 bg-amber-950/20 p-4">
                <div>
                  <Label htmlFor="pearl-private-profile-text" className="text-amber-100" style={FONT}>
                    Private profile
                  </Label>
                </div>
                <textarea
                  id="pearl-private-profile-text"
                  value={privateText}
                  onChange={(event) => setPrivateText(event.target.value)}
                  className="min-h-[150px] w-full resize-none rounded-md border border-amber-700 bg-gray-950 p-3 text-sm leading-5 text-white outline-none focus:border-amber-400"
                  style={FONT}
                  placeholder="Anything Pearl should keep only for you."
                />
              </section>
            )}

            <div className="flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-gray-500">
                {saved ? 'Profile saved.' : `${buildName} - ${commitSha}`}
              </div>
              <Button
                type="button"
                onClick={saveProfile}
                disabled={saving || !userProfileId}
                className="bg-green-600 text-white hover:bg-green-700"
                style={FONT}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
