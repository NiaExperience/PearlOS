'use client';

import { RefreshCw, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { Button } from '@interface/components/ui/button';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';
import { Switch } from '@interface/components/ui/switch';

import type { WebhookEvent } from '@nia/prism/core/blocks/webhookSubscription.block';
import type { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

const EVENT_OPTIONS: Array<{ value: WebhookEvent; label: string }> = [
  { value: 'share.created', label: 'Share Created' },
  { value: 'share.redeemed', label: 'Share Redeemed' },
  { value: 'share.revoked', label: 'Share Revoked' },
  { value: 'share.role_updated', label: 'Share Role Updated' },
  { value: 'task.created', label: 'Task Created' },
  { value: 'task.started', label: 'Task Started' },
  { value: 'task.completed', label: 'Task Completed' },
  { value: 'task.failed', label: 'Task Failed' },
  { value: 'task.cancelled', label: 'Task Cancelled' },
];

interface WebhookSubscription {
  _id?: string;
  url: string;
  events: WebhookEvent[];
  resourceTypes?: ResourceType[];
  isActive: boolean;
  description?: string;
  createdAt?: string;
}

interface WebhookDelivery {
  _id?: string;
  subscriptionId: string;
  event: WebhookEvent;
  status: 'pending' | 'success' | 'failed';
  responseStatus?: number;
  error?: string;
  createdAt?: string;
  deliveredAt?: string;
}

interface WebhooksResponse {
  success?: boolean;
  subscriptions?: WebhookSubscription[];
  deliveries?: WebhookDelivery[];
  error?: string;
}

export function WebhooksPanel({ tenantId }: { tenantId?: string }) {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>(['task.completed', 'task.failed']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const deliverySubscription = useMemo(() => {
    const map = new Map<string, WebhookSubscription>();
    subscriptions.forEach((subscription) => {
      if (subscription._id) map.set(subscription._id, subscription);
    });
    return map;
  }, [subscriptions]);

  const loadWebhooks = async () => {
    if (!tenantId) return;
    setLoading(true);
    setStatus('');
    try {
      const params = new URLSearchParams({ tenantId, includeDeliveries: 'true' });
      const res = await fetch(`/api/webhooks?${params.toString()}`, { cache: 'no-store' });
      const data = (await res.json()) as WebhooksResponse;
      if (!res.ok) throw new Error(data.error || 'Could not load webhooks');
      setSubscriptions(data.subscriptions || []);
      setDeliveries(data.deliveries || []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load webhooks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWebhooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const toggleEvent = (event: WebhookEvent) => {
    setSelectedEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event]
    );
  };

  const createSubscription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantId || selectedEvents.length === 0 || saving) return;
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          url: url.trim(),
          events: selectedEvents,
          ...(secret.trim() ? { secret: secret.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      const data = (await res.json()) as WebhooksResponse;
      if (!res.ok) throw new Error(data.error || 'Could not create webhook');
      setUrl('');
      setSecret('');
      setDescription('');
      setSelectedEvents(['task.completed', 'task.failed']);
      setStatus('Webhook subscription created.');
      await loadWebhooks();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create webhook');
    } finally {
      setSaving(false);
    }
  };

  const patchSubscription = async (subscription: WebhookSubscription, isActive: boolean) => {
    if (!tenantId || !subscription._id) return;
    setStatus('');
    try {
      const res = await fetch('/api/webhooks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, subscriptionId: subscription._id, isActive }),
      });
      const data = (await res.json()) as WebhooksResponse;
      if (!res.ok) throw new Error(data.error || 'Could not update webhook');
      setSubscriptions((current) =>
        current.map((item) => (item._id === subscription._id ? { ...item, isActive } : item))
      );
      setStatus(isActive ? 'Webhook activated.' : 'Webhook disabled.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not update webhook');
    }
  };

  if (!tenantId) {
    return (
      <Card className="border-gray-700 bg-gray-800" style={FONT}>
        <CardHeader>
          <CardTitle className="text-white" style={FONT}>Webhooks</CardTitle>
          <CardDescription className="text-gray-400" style={FONT}>
            Open settings from an assistant workspace to manage tenant webhooks.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-gray-700 bg-gray-800" style={FONT}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-white" style={FONT}>Webhooks</CardTitle>
            <CardDescription className="text-gray-400" style={FONT}>
              Send share and Agency task events to external systems.
            </CardDescription>
          </div>
          <Button type="button" onClick={loadWebhooks} disabled={loading} className="bg-gray-700 text-white hover:bg-gray-600" style={FONT}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6" style={FONT}>
        <form onSubmit={createSubscription} className="space-y-4 rounded-md border border-gray-700 bg-gray-900/40 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="webhook-url" className="text-gray-300" style={FONT}>Endpoint URL</Label>
              <Input id="webhook-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required className="border-gray-700 bg-gray-800 text-white" style={FONT} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-secret" className="text-gray-300" style={FONT}>Secret</Label>
              <Input id="webhook-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} className="border-gray-700 bg-gray-800 text-white" style={FONT} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhook-description" className="text-gray-300" style={FONT}>Description</Label>
            <textarea id="webhook-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-gray-500" style={FONT} />
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {EVENT_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-300" style={FONT}>
                <input type="checkbox" checked={selectedEvents.includes(option.value)} onChange={() => toggleEvent(option.value)} className="h-4 w-4 accent-blue-500" />
                {option.label}
              </label>
            ))}
          </div>
          <Button type="submit" disabled={saving || !url.trim() || selectedEvents.length === 0} className="bg-blue-600 text-white hover:bg-blue-700" style={FONT}>
            {saving ? 'Creating...' : 'Create Webhook'}
          </Button>
        </form>

        {status && <p className="text-xs text-gray-400" style={FONT}>{status}</p>}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white" style={FONT}>Subscriptions</h3>
          {subscriptions.length === 0 ? (
            <div className="rounded-md border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-400" style={FONT}>No webhook subscriptions yet.</div>
          ) : (
            subscriptions.map((subscription) => (
              <div key={subscription._id || subscription.url} className="rounded-md border border-gray-700 bg-gray-900/40 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="break-all text-sm text-white" style={FONT}>{subscription.url}</div>
                    {subscription.description && <div className="text-xs text-gray-400" style={FONT}>{subscription.description}</div>}
                    <div className="flex flex-wrap gap-2">
                      {subscription.events.map((event) => (
                        <span key={event} className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-300" style={FONT}>{event}</span>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500" style={FONT}>Created {formatDate(subscription.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={subscription.isActive} onCheckedChange={(checked) => patchSubscription(subscription, checked)} />
                    <span className={subscription.isActive ? 'text-xs text-green-300' : 'text-xs text-gray-500'} style={FONT}>{subscription.isActive ? 'Active' : 'Inactive'}</span>
                    <Button type="button" onClick={() => patchSubscription(subscription, false)} className="bg-red-600 text-white hover:bg-red-700" style={FONT}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white" style={FONT}>Recent Deliveries</h3>
          {deliveries.length === 0 ? (
            <div className="rounded-md border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-400" style={FONT}>No deliveries recorded yet.</div>
          ) : (
            deliveries.slice(0, 12).map((delivery) => (
              <div key={delivery._id || `${delivery.subscriptionId}-${delivery.createdAt}`} className="grid grid-cols-1 gap-2 rounded-md border border-gray-700 bg-gray-900/40 p-3 text-xs md:grid-cols-[1fr_auto_auto] md:items-center">
                <div className="min-w-0">
                  <div className="text-white" style={FONT}>{delivery.event}</div>
                  <div className="truncate text-gray-500" style={FONT}>{deliverySubscription.get(delivery.subscriptionId)?.url || delivery.subscriptionId}</div>
                </div>
                <span className={delivery.status === 'success' ? 'text-green-300' : delivery.status === 'failed' ? 'text-red-300' : 'text-gray-300'} style={FONT}>
                  {delivery.status}{delivery.responseStatus ? ` / ${delivery.responseStatus}` : ''}
                </span>
                <span className="text-gray-500" style={FONT}>{formatDate(delivery.deliveredAt || delivery.createdAt)}</span>
              </div>
            ))
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function formatDate(value?: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
