'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@interface/components/ui/button';
import { Input } from '@interface/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { clearPearlOSCodeLocalState } from '@interface/lib/pearlos-code-reset-client';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

type Props = {
  compact?: boolean;
};

export function PearlOSCodeResetPanel({ compact = false }: Props) {
  const [armed, setArmed] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/pearlos/reset-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET PEARLOS CODE' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'reset_failed');
      }
      clearPearlOSCodeLocalState();
      setArmed(false);
      setConfirmation('');
      setMessage('PearlOS code reset to the default production shell.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <div className="space-y-3" style={FONT}>
      <div className="rounded-md border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-100" style={FONT}>
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Reset PearlOS Code
        </div>
        <p className="leading-5 text-red-100/80" style={FONT}>
          This removes active custom themes, installed personal features, community feature installs, and the account-local change ledger. Notes, files, credentials, profile, and shared production code are not deleted.
        </p>
      </div>

      {!armed ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setArmed(true)}
          className="w-full border-red-500/50 bg-red-950/20 text-red-100 hover:bg-red-900/40"
          style={FONT}
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          RESET PEARLOS CODE
        </Button>
      ) : (
        <div className="space-y-2">
          <Input
            aria-label="Reset confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="RESET PEARLOS CODE"
            className="border-red-500/40 bg-gray-950 text-red-50 placeholder:text-red-100/30"
            style={FONT}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={reset}
              disabled={busy || confirmation !== 'RESET PEARLOS CODE'}
              className="flex-1 bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
              style={FONT}
            >
              {busy ? 'Resetting' : 'Confirm Reset'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setArmed(false);
                setConfirmation('');
              }}
              disabled={busy}
              className="flex-1 border-gray-600 bg-gray-900/60 text-gray-200 hover:bg-gray-700"
              style={FONT}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p className="text-xs text-gray-300" style={FONT}>
          {message}
        </p>
      )}
    </div>
  );

  if (compact) return content;

  return (
    <Card className="border-gray-700 bg-gray-800" style={FONT}>
      <CardHeader>
        <CardTitle className="text-white" style={FONT}>Recovery</CardTitle>
        <CardDescription className="text-gray-400" style={FONT}>
          Return this account to the default PearlOS production build.
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
