"use client";
import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@dashboard/components/ui/card';
import { Input } from '@dashboard/components/ui/input';
import { Button } from '@dashboard/components/ui/button';

export function ResetPassword() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing reset token. Please use the link from your email.');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/users/complete-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Reset failed');
      }
      setMessage('Password updated successfully. You can now sign in. Redirecting to login...');
      setTimeout(() => router.push('/login'), 2500);
    } catch (e: any) {
      setError(e.message || 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-2">
        <CardHeader>
          <CardTitle className="text-xl">Reset Password</CardTitle>
          <CardDescription>Enter a new password for your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm mb-1">New Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={submitting || !token} required minLength={8} />
            </div>
            <div>
              <label className="block text-sm mb-1">Confirm Password</label>
              <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={submitting || !token} required minLength={8} />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {message && <p className="text-sm text-green-600">{message}</p>}
            <Button type="submit" className="w-full" disabled={submitting || !token}>
              {submitting ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
          {!token && (
            <p className="mt-4 text-xs text-muted-foreground">No token present. Request a new reset email from the login page.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
