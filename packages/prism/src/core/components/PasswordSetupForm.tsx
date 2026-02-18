"use client";
import React, { useState } from 'react';
// TODO(security): Add rate limiting (e.g., simple in-memory counter or redis) to POST /api/users/set-password to deter brute force.
// TODO(security): Enforce stronger password policy (min length, character classes, common password blacklist, haveibeenpwned check).

export interface PasswordSetupFormProps {
  onSuccess?: () => void;
  minLength?: number;
  fetchImpl?: typeof fetch; // for tests
  endpoint?: string; // override default endpoint
}

export const PasswordSetupForm: React.FC<PasswordSetupFormProps> = ({ onSuccess, minLength = 8, fetchImpl, endpoint }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = password.length >= minLength && confirm.length >= minLength && password === confirm && !loading;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await (fetchImpl || fetch)(endpoint || '/api/users/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmPassword: confirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to set password');
      }
      setSuccess(true);
      try {
        // Attempt to refresh session in NextAuth (App Router) without full reload
        await (fetchImpl || fetch)('/api/auth/session?update=1', { cache: 'no-store' }).catch(() => {});
      } catch {}
      onSuccess?.();
    } catch (e: any) {
      setError(e.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return <div className="p-4 border rounded bg-green-50 text-green-800 text-sm">Password set successfully. You can continue.</div>;
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-sm">
      <div className="space-y-1">
        <label className="text-sm font-medium">New Password</label>
        <input
          type="password"
            className="w-full border rounded px-3 py-2 text-sm"
          value={password}
          onChange={e => setPassword(e.target.value)}
          minLength={minLength}
          required
        />
        <p className="text-xs text-muted-foreground">Minimum {minLength} characters.</p>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Confirm Password</label>
        <input
          type="password"
            className="w-full border rounded px-3 py-2 text-sm"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          minLength={minLength}
          required
        />
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full bg-blue-600 disabled:opacity-40 text-white rounded px-3 py-2 text-sm font-medium"
      >
        {loading ? 'Saving…' : 'Set Password'}
      </button>
    </form>
  );
};

export default PasswordSetupForm;
