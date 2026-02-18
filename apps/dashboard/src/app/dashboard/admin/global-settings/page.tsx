'use client';

import {
  DEFAULT_INTERFACE_LOGIN_SETTINGS,
  resolveInterfaceLoginSettings,
  type InterfaceLoginSettings,
} from '@nia/features';
import { Trash2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@dashboard/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dashboard/components/ui/card';
import { Input } from '@dashboard/components/ui/input';
import { Switch } from '@dashboard/components/ui/switch';
import { useToast } from '@dashboard/hooks/use-toast';
import {
  LOGIN_FEATURE_KEYS,
  LOGIN_FEATURE_METADATA,
  type LoginFeatureKey,
} from '@dashboard/lib/feature-normalization';

export const dynamic = 'force-dynamic';

type LoginSettingsState = InterfaceLoginSettings;

type FetchState = 'idle' | 'loading' | 'error';

type ApiResponse = {
  settings: {
    interfaceLogin?: Partial<InterfaceLoginSettings>;
    denyListEmails?: string[];
  };
};

export default function GlobalSettingsAdminPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<FetchState>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<LoginSettingsState>(() => ({
    ...DEFAULT_INTERFACE_LOGIN_SETTINGS,
  }));
  const [baseline, setBaseline] = useState<LoginSettingsState>(() => ({
    ...DEFAULT_INTERFACE_LOGIN_SETTINGS,
  }));

  // Deny list state
  const [denyListEmails, setDenyListEmails] = useState<string[]>([]);
  const [denyListBaseline, setDenyListBaseline] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [denyListSaving, setDenyListSaving] = useState(false);
  const [denyListError, setDenyListError] = useState<string | null>(null);

  const isDirty = useMemo(
    () => LOGIN_FEATURE_KEYS.some(key => settings[key] !== baseline[key]),
    [settings, baseline],
  );

  const isDenyListDirty = useMemo(() => {
    if (denyListEmails.length !== denyListBaseline.length) return true;
    return denyListEmails.some((email, idx) => email !== denyListBaseline[idx]);
  }, [denyListEmails, denyListBaseline]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus('loading');
      setError(null);
      try {
        const res = await fetch('/api/global-settings', { cache: 'no-store' });
        if (!res.ok) {
          const detail = res.status === 403 ? 'You must be a superadmin to view global settings.' : 'Unable to load global settings.';
          throw new Error(detail);
        }
        const data = (await res.json()) as ApiResponse;
        const resolved = resolveInterfaceLoginSettings(data.settings);
        const emails = data.settings.denyListEmails || [];
        if (!cancelled) {
          setSettings({ ...resolved });
          setBaseline({ ...resolved });
          setDenyListEmails([...emails]);
          setDenyListBaseline([...emails]);
          setStatus('idle');
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unable to load global settings.';
          setError(message);
          setStatus('error');
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = (key: LoginFeatureKey, value: boolean) => {
    setSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleReset = () => {
    setSettings({ ...baseline });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/global-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interfaceLogin: settings }),
      });
      if (!res.ok) {
        const detail = res.status === 403 ? 'You do not have permission to update global settings.' : 'Failed to update global settings.';
        throw new Error(detail);
      }
      const data = (await res.json()) as ApiResponse;
      const resolved = resolveInterfaceLoginSettings(data.settings);
      setSettings({ ...resolved });
      setBaseline({ ...resolved });
      toast({
        title: 'Global settings updated',
        description: 'Interface login options have been saved.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update global settings.';
      setError(message);
      toast({
        title: 'Save failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Deny list handlers
  const handleAddEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setDenyListError('Please enter a valid email address');
      return;
    }
    if (denyListEmails.includes(email)) {
      setDenyListError('This email is already in the deny list');
      return;
    }
    setDenyListEmails(prev => [...prev, email]);
    setNewEmail('');
    setDenyListError(null);
  };

  const handleRemoveEmail = (email: string) => {
    setDenyListEmails(prev => prev.filter(e => e !== email));
  };

  const handleDenyListSave = async () => {
    setDenyListSaving(true);
    setDenyListError(null);
    try {
      const res = await fetch('/api/global-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ denyListEmails }),
      });
      if (!res.ok) {
        const detail = res.status === 403 ? 'You do not have permission to update global settings.' : 'Failed to update deny list.';
        throw new Error(detail);
      }
      const data = (await res.json()) as ApiResponse;
      const emails = data.settings.denyListEmails || [];
      setDenyListEmails([...emails]);
      setDenyListBaseline([...emails]);
      toast({
        title: 'Deny list updated',
        description: 'Email deny list has been saved.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update deny list.';
      setDenyListError(message);
      toast({
        title: 'Save failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setDenyListSaving(false);
    }
  };

  const handleDenyListReset = () => {
    setDenyListEmails([...denyListBaseline]);
    setNewEmail('');
    setDenyListError(null);
  };

  const disableToggles = status === 'loading' || saving;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Global Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage platform-wide defaults for assistant login options.
          </p>
        </div>
        <Link href="/dashboard/admin" className="text-sm underline">
          Back to Admin
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Interface Login Methods</CardTitle>
          <CardDescription>
            Enable or disable login methods that assistants can offer by default. Individual assistants can
            still opt out of globally enabled methods.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {status === 'loading' ? (
            <p className="text-sm text-muted-foreground">Loading global settings…</p>
          ) : (
            <>
              <div className="columns-1 gap-x-6 sm:columns-2 lg:columns-3">
                {LOGIN_FEATURE_KEYS.map(key => {
                  const metadata = LOGIN_FEATURE_METADATA[key];
                  return (
                    <div
                      key={key}
                      className="mb-4 break-inside-avoid rounded-md border border-border/60 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium leading-none">{metadata.label}</p>
                          <p className="text-xs text-muted-foreground">{metadata.description}</p>
                        </div>
                        <Switch
                          checked={settings[key]}
                          onCheckedChange={value => handleToggle(key, value)}
                          disabled={disableToggles}
                          aria-label={`${metadata.label} toggle`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleSave} disabled={!isDirty || saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  disabled={!isDirty || saving}
                >
                  Discard Changes
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Email Deny List Card */}
      <Card>
        <CardHeader>
          <CardTitle>Email Deny List</CardTitle>
          <CardDescription>
            Block specific email addresses from signing in to the platform. Users with these email addresses
            will receive an &quot;Access Denied&quot; message when attempting to log in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {status === 'loading' ? (
            <p className="text-sm text-muted-foreground">Loading deny list…</p>
          ) : (
            <>
              {/* Add email form */}
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="Enter email address to block"
                  value={newEmail}
                  onChange={e => {
                    setNewEmail(e.target.value);
                    setDenyListError(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddEmail();
                    }
                  }}
                  disabled={denyListSaving}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddEmail}
                  disabled={denyListSaving || !newEmail.trim()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>

              {denyListError && (
                <p className="text-sm text-destructive">{denyListError}</p>
              )}

              {/* Email list */}
              {denyListEmails.length === 0 ? (
                <p className="text-sm text-muted-foreground">No emails in the deny list.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Blocked emails ({denyListEmails.length}):</p>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
                    {denyListEmails.map(email => (
                      <div
                        key={email}
                        className="flex items-center justify-between border-b border-border/40 px-3 py-2 last:border-b-0"
                      >
                        <span className="text-sm font-mono">{email}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveEmail(email)}
                          disabled={denyListSaving}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Remove {email}</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save/Reset buttons */}
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleDenyListSave} disabled={!isDenyListDirty || denyListSaving}>
                  {denyListSaving ? 'Saving…' : 'Save Deny List'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDenyListReset}
                  disabled={!isDenyListDirty || denyListSaving}
                >
                  Discard Changes
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
