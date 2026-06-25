'use client';

import { Bot, BrainCircuit, Check, RefreshCw, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

type AgencyBoss = 'claude' | 'codex';

type AgencyBossResponse = {
  boss: AgencyBoss;
  updatedAt?: string;
  restart?: {
    ok: boolean;
    message: string;
  };
};

const BOSS_LABELS: Record<AgencyBoss, string> = {
  claude: 'Claude Opus 4.8',
  codex: 'Codex',
};

const OPTIONS: Array<{
  value: AgencyBoss;
  label: string;
  description: string;
  Icon: LucideIcon;
}> = [
  {
    value: 'codex',
    label: 'Codex',
    description: 'Use Codex CLI as the Agency Boss for queued work.',
    Icon: Bot,
  },
  {
    value: 'claude',
    label: BOSS_LABELS.claude,
    description: 'Use Claude Opus 4.8 as the fallback Agency Boss for queued work.',
    Icon: BrainCircuit,
  },
];

export function AgencyBossPanel() {
  const [boss, setBoss] = useState<AgencyBoss>('codex');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AgencyBoss | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/agency-boss', { cache: 'no-store' });
        const data = (await res.json()) as AgencyBossResponse;
        if (!cancelled && (data.boss === 'claude' || data.boss === 'codex')) {
          setBoss(data.boss);
          setStatus(data.updatedAt ? `Last changed ${new Date(data.updatedAt).toLocaleString()}` : '');
        }
      } catch {
        if (!cancelled) setStatus('Could not read Agency Boss setting.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateBoss = async (nextBoss: AgencyBoss) => {
    if (nextBoss === boss || saving) return;
    setSaving(nextBoss);
    setStatus('Applying change...');
    try {
      const res = await fetch('/api/agency-boss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boss: nextBoss, apply: true }),
      });
      const data = (await res.json()) as AgencyBossResponse;
      if (!res.ok || !data.restart?.ok) {
        throw new Error(data.restart?.message || 'Unable to restart worker');
      }
      setBoss(data.boss);
      setStatus(`${BOSS_LABELS[nextBoss]} is now the Agency Boss.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not apply Agency Boss setting.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="border-gray-700 bg-gray-800" style={FONT}>
      <CardHeader>
        <CardTitle className="text-white" style={FONT}>Agency Boss</CardTitle>
        <CardDescription className="text-gray-400" style={FONT}>
          Choose which CLI runs Pearl&apos;s queued Agency work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" style={FONT}>
        <div className="space-y-2">
          {OPTIONS.map(({ value, label, description, Icon }) => {
            const selected = boss === value;
            const isSaving = saving === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => updateBoss(value)}
                disabled={loading || Boolean(saving)}
                className={`w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors border disabled:cursor-wait disabled:opacity-70 ${
                  selected
                    ? 'border-blue-500 bg-blue-900/30 text-white'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
                style={FONT}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium" style={FONT}>{label}</div>
                  <div className="text-xs text-gray-500" style={FONT}>{description}</div>
                </div>
                {isSaving ? (
                  <RefreshCw className="ml-auto h-4 w-4 flex-shrink-0 animate-spin text-blue-300" />
                ) : selected ? (
                  <Check className="ml-auto h-4 w-4 flex-shrink-0 text-blue-400" />
                ) : null}
              </button>
            );
          })}
        </div>

        {status && (
          <p className="text-xs text-gray-400" style={FONT}>
            {status}
          </p>
        )}

      </CardContent>
    </Card>
  );
}
