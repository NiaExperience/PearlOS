/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { IUserProfile } from '@nia/prism/core/blocks/userProfile.block';
import { Save, Eraser, History, FileText } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@dashboard/components/ui/badge';
import { Button } from '@dashboard/components/ui/button';
import { Card, CardContent, CardHeader } from '@dashboard/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dashboard/components/ui/dialog';
import { JsonTree } from '@dashboard/components/ui/json-tree';
import { Popover, PopoverContent, PopoverTrigger } from '@dashboard/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@dashboard/components/ui/tooltip';
import { useToast } from '@dashboard/hooks/use-toast';

import {
  buildConversationSummaries,
  ConversationSummaryGroup,
  hasConversationSummaries,
} from './conversation-summaries';

export default function AdminUserProfilePage() {
  const { toast } = useToast();
  const [items, setItems] = useState<IUserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savingId, setSavingId] = useState<string | undefined>();
  const [deletingId, setDeletingId] = useState<string | undefined>();
  // Track rows where the user has requested clearing userId but not yet saved
  const [pendingClear, setPendingClear] = useState<Record<string, boolean>>({});

  // Conversation summary dialog state
  const [conversationSummaryOpen, setConversationSummaryOpen] = useState(false);
  const [conversationSummaryProfile, setConversationSummaryProfile] = useState<IUserProfile | null>(null);
  const [conversationSummaryGroups, setConversationSummaryGroups] = useState<ConversationSummaryGroup[]>([]);

  // Session history dialog state
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false);
  const [sessionHistoryProfile, setSessionHistoryProfile] = useState<IUserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(undefined);
      try {
        const res = await fetch(`/api/userProfile`);
        if (!res.ok) throw new Error((await res.text()) || 'Failed to load UserProfiles');
        const data = await res.json();
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () =>
      items.map(it => {
        let metadata: Record<string, unknown> = {};
        if (it.metadata !== undefined && it.metadata !== null) metadata = it.metadata;
        const details = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
        const clipped =
          details.length > 0 ? (details.length > 80 ? details.slice(0, 80) + '…' : details) : '—';
        const hasSummaries = hasConversationSummaries(it);
        return {
          id: it._id,
          name: it.first_name || '—',
          email: it.email || '—',
          details,
          clipped,
          raw: it,
          hasSummaries,
        };
      }),
    [items]
  );

  const handleViewConversationSummaries = (profile: IUserProfile) => {
    const groups = buildConversationSummaries(profile);
    setConversationSummaryGroups(groups);
    setConversationSummaryProfile(profile);
    setConversationSummaryOpen(true);
  };

  const handleConversationDialogChange = (open: boolean) => {
    setConversationSummaryOpen(open);
    if (!open) {
      setConversationSummaryProfile(null);
      setConversationSummaryGroups([]);
    }
  };

  const formatTimestamp = (value?: string) => {
    if (!value) return 'Unknown time';
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return 'Unknown time';
    return new Date(parsed).toLocaleString();
  };

  const formatDuration = (value?: number) => {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
      return undefined;
    }

    if (value < 60) {
      return `${Math.round(value)}s`;
    }

    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);

    if (seconds === 0) {
      return `${minutes}m`;
    }

    return `${minutes}m ${seconds}s`;
  };

  // Handler for viewing session history
  const handleViewSessionHistory = (profile: IUserProfile) => {
    setSessionHistoryProfile(profile);
    setSessionHistoryOpen(true);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">UserProfile Records</h1>
      {loading && <div className="text-muted-foreground text-xs">Loading…</div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-accent/40 text-left">
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">First name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">User ID</th>
              <th className="w-[40%] px-3 py-2 font-medium">Details</th>
              <th className="px-3 py-2 text-right font-medium">Tools</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 align-top">
                  <span className="text-muted-foreground font-mono text-[10px]" title={r.id}>
                    {r.id?.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <form 
                    id={`profile-form-${r.id}`}
                    onSubmit={async e => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget as HTMLFormElement);
                      const first_name = String(fd.get('first_name') || '').trim();
                      const email = String(fd.get('email') || '').trim();
                      const isPendingClear = r.id ? Boolean(pendingClear[r.id]) : false;
                      const removeUserId = Boolean(isPendingClear || !r.raw.userId);
                      
                      // Allow save if first_name changed, email changed, OR userId is pending clear
                      const firstNameChanged = first_name !== r.raw.first_name;
                      const emailChanged = email && email !== r.raw.email;
                      if (!firstNameChanged && !emailChanged && !isPendingClear) return;
                      
                      setSavingId(r.id);
                      setError(undefined);
                      try {
                        const res = await fetch('/api/userProfile', {
                          method: 'PUT',
                          headers: { 'content-type': 'application/json', 'x-remove-user-id': String(removeUserId) },
                          body: JSON.stringify({ id: r.id, first_name, email }),
                        });
                        if (!res.ok) {
                          const msg = await res.text();
                          throw new Error(msg || 'Failed to update profile');
                        }
                        await res.json();
                        setItems(prev =>
                          prev.map(it =>
                            it._id === r.id
                              ? { ...it, first_name, email, userId: removeUserId ? undefined : (it as any).userId }
                              : it
                          )
                        );
                        // Clear pending flag after successful save
                        if (r.id) {
                          setPendingClear(prev => {
                            const next = { ...prev };
                            delete next[r.id!];
                            return next;
                          });
                        }
                        toast({ title: 'Profile updated', description: `Updated ${first_name || email}` });
                      } catch (e: any) {
                        setError(e.message);
                        toast({
                          title: 'Update failed',
                          description: e.message || 'Unable to update profile',
                          variant: 'destructive',
                        });
                      } finally {
                        setSavingId(undefined);
                      }
                    }}
                  >
                    <input
                      type="text"
                      name="first_name"
                      defaultValue={r.name === '—' ? '' : r.name}
                      className="w-[150px] rounded border px-1 py-0.5 text-xs"
                      disabled={savingId === r.id}
                      placeholder="First name"
                    />
                  </form>
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="email"
                    name="email"
                    form={`profile-form-${r.id}`}
                    defaultValue={r.email}
                    className="w-[220px] rounded border px-1 py-0.5 font-mono text-xs"
                    disabled={savingId === r.id}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-2">
                    {(r.id && pendingClear[r.id]) ? (
                      <span className="text-muted-foreground font-mono text-[10px]">—</span>
                    ) : r.raw.userId ? (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(r.raw.userId!);
                          toast({
                            title: 'Copied to clipboard',
                            description: r.raw.userId,
                          });
                        }}
                        className="text-muted-foreground hover:text-foreground font-mono text-[10px] cursor-pointer underline decoration-dotted"
                        title={`Click to copy: ${r.raw.userId}`}
                      >
                        {r.raw.userId.slice(0, 8)}…
                      </button>
                    ) : (
                      <span className="text-muted-foreground font-mono text-[10px]">—</span>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={(r.id && pendingClear[r.id]) ? 'Undo clear userId' : 'Clear userId'}
                            title={(r.id && pendingClear[r.id]) ? 'Undo clear userId' : 'Clear userId'}
                            className="hover:bg-accent inline-flex items-center justify-center rounded border px-1 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!r.raw.userId && !(r.id && pendingClear[r.id])}
                            onClick={() => {
                              // Toggle local clear state; no network call. Save will persist.
                              if (!r.id) return;
                              setPendingClear(prev => ({ ...prev, [r.id!]: !prev[r.id!] }));
                            }}
                          >
                            <Eraser className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {(r.id && pendingClear[r.id])
                            ? 'Marked for removal — click again to restore before saving'
                            : 'Mark for removal — click Save to persist'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  {r.raw.metadata && Object.keys(r.raw.metadata).length > 0 ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground inline-block max-w-full truncate align-top text-xs cursor-pointer underline decoration-dotted">
                          {r.clipped}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[600px] max-h-[500px] overflow-y-auto">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-sm">Metadata</h4>
                          <JsonTree data={r.raw.metadata} />
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                    {/* Save button for profile (first_name + email) */}
                    <button
                      type="submit"
                      form={`profile-form-${r.id}`}
                      aria-label="Save profile"
                      title="Save"
                      className="hover:bg-accent inline-flex items-center justify-center rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={savingId === r.id}
                    >
                      <Save className="h-4 w-4" />
                    </button>
                    {/* Invite badge button: dovetails into existing invite workflow */}
                    <Link
                      href={`/dashboard/admin/tenants?inviteEmail=${encodeURIComponent(r.email)}`}
                      className="inline-flex items-center"
                      title={`Invite ${r.email}`}
                    >
                      <Badge className="cursor-pointer">Invite</Badge>
                    </Link>
                    {/* Conversation summaries button */}
                    <button
                      type="button"
                      onClick={() => handleViewConversationSummaries(r.raw)}
                      aria-label="View conversation summaries"
                      title={r.hasSummaries ? 'View conversation summaries' : 'No conversation summaries'}
                      className="hover:bg-accent inline-flex items-center justify-center rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!r.hasSummaries}
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    {/* Session history button - always shown, disabled if no history */}
                    <button
                      type="button"
                      onClick={() => handleViewSessionHistory(r.raw)}
                      aria-label="View session history"
                      title={r.raw.sessionHistory && r.raw.sessionHistory.length > 0 ? "View session history" : "No session history"}
                      className="hover:bg-accent inline-flex items-center justify-center rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!r.raw.sessionHistory || r.raw.sessionHistory.length === 0}
                    >
                      <History className="h-4 w-4" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Delete this UserProfile (User will remain)?')) return;
                        setDeletingId(r.id);
                        setError(undefined);
                        try {
                          const res = await fetch('/api/userProfile', {
                            method: 'DELETE',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ id: r.id }),
                          });
                          if (!res.ok) throw new Error((await res.text()) || 'Failed to delete');
                          setItems(prev => prev.filter(it => it._id !== r.id));
                          toast({ title: 'UserProfile deleted', description: r.email || r.id });
                        } catch (e: any) {
                          setError(e.message);
                          toast({
                            title: 'Delete failed',
                            description: e.message || 'Unable to delete UserProfile',
                            variant: 'destructive',
                          });
                        } finally {
                          setDeletingId(undefined);
                        }
                      }}
                      aria-label="Delete UserProfile"
                      className="inline-flex items-center justify-center rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={deletingId === r.id}
                      title="Delete UserProfile"
                    >
                      {deletingId === r.id ? '…' : 'X'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="text-muted-foreground px-3 py-6 text-center text-xs">
                  No UserProfile records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Conversation Summaries Dialog */}
      <Dialog open={conversationSummaryOpen} onOpenChange={handleConversationDialogChange}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conversation Summaries</DialogTitle>
            <DialogDescription>
              {conversationSummaryProfile
                ? `${conversationSummaryProfile.first_name || 'User'} (${conversationSummaryProfile.email})`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {conversationSummaryGroups.length > 0 ? (
              conversationSummaryGroups.map((group, idx) => {
                const durationLabel = formatDuration(group.durationSeconds);
                return (
                  <Card key={group.sessionId ?? `conversation-${idx}`} className="border">
                    <CardHeader className="space-y-1 pb-3">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="font-medium">
                          {group.sessionId ? `Session ${group.sessionId}` : 'Session'}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {group.latestTimestamp && (
                            <span>
                              Latest:
                              <span className="ml-1 font-medium text-foreground">
                                {formatTimestamp(group.latestTimestamp)}
                              </span>
                            </span>
                          )}
                          {group.assistantName && (
                            <span>
                              Assistant:
                              <span className="ml-1 font-medium text-foreground">
                                {group.assistantName}
                              </span>
                            </span>
                          )}
                          {typeof group.participantCount === 'number' && (
                            <span>Participants: {group.participantCount}</span>
                          )}
                          {durationLabel && <span>Duration: {durationLabel}</span>}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {group.items.map((item, itemIdx) => (
                        <div
                          key={`${group.sessionId ?? 'session'}-${idx}-${itemIdx}`}
                          className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3"
                        >
                          <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(item.timestamp)}
                          </span>
                          <div className="text-sm leading-relaxed whitespace-pre-wrap">
                            {item.summary}
                            {item.resourceId && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (ID: {item.resourceId})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <div className="text-muted-foreground text-center text-sm">
                No conversation summaries available
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleConversationDialogChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session History Dialog */}
      <Dialog open={sessionHistoryOpen} onOpenChange={setSessionHistoryOpen}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Session History</DialogTitle>
            <DialogDescription>
              {sessionHistoryProfile
                ? `${sessionHistoryProfile.first_name || 'User'} (${sessionHistoryProfile.email})`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {sessionHistoryProfile?.sessionHistory && sessionHistoryProfile.sessionHistory.length > 0 ? (
              sessionHistoryProfile.sessionHistory.map((entry, idx) => (
                <Card key={idx} className="border">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {new Date(entry.time).toLocaleString()}
                      </span>
                      <span className="text-muted-foreground">{entry.action}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {entry.sessionId && (
                      <div>
                        <span className="font-medium">Session ID: </span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {entry.sessionId}
                        </span>
                      </div>
                    )}
                    {entry.refIds && entry.refIds.length > 0 && (
                      <div>
                        <span className="font-medium">Reference IDs: </span>
                        <div className="mt-1 space-y-1">
                          {entry.refIds.map((refId, refIdx) => (
                            <div key={refIdx} className="text-muted-foreground text-xs">
                              <span className="font-medium">{refId.type}: </span>
                              <span className="font-mono">{refId.id}</span>
                              {refId.description && (
                                <span className="ml-2 italic">({refId.description})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="text-muted-foreground text-center text-sm">
                No session history available
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
