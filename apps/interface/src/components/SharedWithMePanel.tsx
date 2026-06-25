'use client';

import { Bell, ExternalLink, Inbox, Loader2, RefreshCw, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@interface/components/ui/button';
import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('SharedWithMePanel');

interface SharedWithMePanelProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId?: string;
}

interface SharedItem {
  resourceId: string;
  resourceType: 'Notes' | 'Apps' | 'HtmlGeneration' | string;
  title: string;
  role: string;
  ownerName?: string;
  href?: string;
  sharedToAllReadOnly?: boolean;
}

interface NotificationItem {
  _id?: string;
  title: string;
  body?: string;
  isRead: boolean;
  createdAt?: string;
}

function itemTypeLabel(type: string): string {
  if (type === 'Apps' || type === 'HtmlGeneration') return 'App';
  if (type === 'Notes') return 'Note';
  return 'Resource';
}

export function SharedWithMePanel({ isOpen, onClose, tenantId }: SharedWithMePanelProps) {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tenantId });
      const [sharedRes, notificationRes] = await Promise.all([
        fetch(`/api/shared-with-me?${params.toString()}`),
        fetch(`/api/notifications?${params.toString()}&limit=5`),
      ]);

      if (!sharedRes.ok) throw new Error('Failed to load shared resources');
      if (!notificationRes.ok) throw new Error('Failed to load notifications');

      const sharedJson = await sharedRes.json();
      const notificationJson = await notificationRes.json();
      setItems(Array.isArray(sharedJson.items) ? sharedJson.items : []);
      setNotifications(Array.isArray(notificationJson.notifications) ? notificationJson.notifications : []);
    } catch (loadError) {
      log.error('Shared panel load failed', { error: loadError });
      setError(loadError instanceof Error ? loadError.message : 'Failed to load shared resources');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const markAllRead = async () => {
    if (!tenantId) return;
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, markAllRead: true }),
    }).catch((markError) => log.warn('Mark notifications read failed', { error: markError }));
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
  };

  if (!isOpen) return null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-[700] flex items-start justify-end bg-black/30 p-3 backdrop-blur-sm sm:p-4">
      <aside className="flex h-[min(760px,calc(100svh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-white/15 bg-zinc-950/95 text-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-cyan-300" />
            <h2 className="text-sm font-semibold">Shared With Me</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70" onClick={load} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70" onClick={onClose} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="border-b border-white/10 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-white/60">
              <Bell className="h-3.5 w-3.5" />
              Notifications
            </div>
            {notifications.some((item) => !item.isRead) && (
              <button className="text-xs text-cyan-300 hover:text-cyan-100" onClick={markAllRead}>
                Mark read
              </button>
            )}
          </div>
          <div className="space-y-2">
            {notifications.length === 0 && <p className="text-sm text-white/50">No sharing updates.</p>}
            {notifications.map((item, index) => (
              <div key={item._id || index} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <p className={`text-sm ${item.isRead ? 'text-white/70' : 'text-white'}`}>{item.title}</p>
                {item.body && <p className="mt-1 text-xs text-white/45">{item.body}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading shared resources
            </div>
          )}
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-white/50">
              <Inbox className="h-7 w-7" />
              <p className="text-sm">Nothing shared here yet.</p>
            </div>
          )}
          <div className="space-y-2">
            {items.map((item) => (
              <a
                key={`${item.resourceType}:${item.resourceId}`}
                href={item.href || '#'}
                className="block rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 transition hover:border-cyan-300/40 hover:bg-white/[0.07]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {itemTypeLabel(item.resourceType)} • {item.role}
                      {item.ownerName ? ` • ${item.ownerName}` : ''}
                    </p>
                  </div>
                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-white/35" />
                </div>
              </a>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
