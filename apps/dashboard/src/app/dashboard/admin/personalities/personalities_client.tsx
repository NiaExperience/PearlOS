/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { Loader2, Plus, X, History, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@dashboard/components/ui/badge';
import { Button } from '@dashboard/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@dashboard/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dashboard/components/ui/dialog';
import { Input } from '@dashboard/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@dashboard/components/ui/popover';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@dashboard/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dashboard/components/ui/tooltip';
import { useToast } from '@dashboard/hooks/use-toast';

import { PersonalityWizardDialog, WizardTarget } from './personality_wizard_dialog';

// Rough token estimation: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface PersonalityHistoryEntry {
  userId: string;
  delta: string;
  modifiedAt: string;
}

interface PersonalityRow {
  _id: string;
  name?: string;
  description?: string;
  tenantId: string;
  primaryPrompt?: string;
  beats?: Array<{ message: string; start_time: number }>;
  usageCount?: number;
  history?: PersonalityHistoryEntry[];
  lastModifiedByUserId?: string;
  updatedAt?: string;
}
interface Tenant {
  id: string;
  name: string;
}

type SortKey = 'name' | 'tenant' | 'used' | 'tokens';

export default function PersonalitiesAdminPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PersonalityRow[]>([]);
  // Keep a ref of the latest rows to avoid stale closures in async handlers
  const rowsRef = useRef<PersonalityRow[]>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Editing state to freeze sorting while renaming inline
  const [editingId, setEditingId] = useState<string | null>(null);
  // Capture a frozen order of row IDs when editing begins; use it to render a stable order
  const [frozenOrderIds, setFrozenOrderIds] = useState<string[] | null>(null);
  // Track original value for revert-on-escape and a skip-save flag
  const [editingOriginalName, setEditingOriginalName] = useState<string>('');
  const skipNextSaveRef = useRef<string | null>(null);
  // Tenant filter removed; management now always displays all tenants.
  
  // History dialog state
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyPersonality, setHistoryPersonality] = useState<PersonalityRow | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTarget, setWizardTarget] = useState<WizardTarget | null>(null);
  
  // Token/character counting for primary prompt
  const [primaryPromptChars, setPrimaryPromptChars] = useState(0);
  const [primaryPromptTokens, setPrimaryPromptTokens] = useState(0);
  const [allPersonalityTokens, setAllPersonalityTokens] = useState<Map<string, number>>(new Map());

  // Load tenants
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tenants');
        if (res.ok) {
          const data = await res.json();
          const list: Tenant[] = (data.items || data.tenants || []).map((t: any) => ({
            id: t.id || t._id,
            name: t.name || t.slug || 'Unnamed Tenant',
          }));
          list.sort((a, b) => a.name.localeCompare(b.name));
          setTenants(list);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all personalities (cross-tenant) in a single call
      const res = await fetch('/api/personalities');
      if (!res.ok) {
        setRows([]);
        return;
      }
      const data = await res.json();
      const personalities: any[] = data.items || [];
      // Collect distinct tenantIds from personalities (fallback to filter list)
      const tenantIds = Array.from(new Set(personalities.map(p => p.tenantId).filter(Boolean)));
      // Fetch assistants per tenant in parallel (bounded)
      const assistantMap: Record<string, any[]> = {};
      await Promise.all(
        tenantIds.map(async tid => {
          try {
            const ar = await fetch(`/api/assistants?tenantId=${tid}`);
            if (!ar.ok) {
              assistantMap[tid] = [];
              return;
            }
            const aj = await ar.json();
            assistantMap[tid] = aj.assistants || [];
          } catch {
            assistantMap[tid] = [];
          }
        })
      );
      const all: PersonalityRow[] = personalities.map(p => {
        const pid = p._id || p.page_id;
        // Count assistants that reference this personality either as primary (personalityId)
        // or in modePersonalityVoiceConfig.
        const usage = (assistantMap[p.tenantId] || []).filter(
          a => {
            if (a?.personalityId === pid) return true;
            if (a?.modePersonalityVoiceConfig) {
              return Object.values(a.modePersonalityVoiceConfig).some((cfg: any) => cfg?.config?.personalityId === pid);
            }
            return false;
          }
        ).length;
        return {
          _id: pid,
          name: p.name,
          description: p.description,
          tenantId: p.tenantId,
          primaryPrompt: p.primaryPrompt,
          beats: p.beats,
          usageCount: usage,
          history: p.history,
          lastModifiedByUserId: p.lastModifiedByUserId,
          updatedAt: p.updatedAt,
        };
      });
      setRows(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Calculate token counts for all personalities
  useEffect(() => {
    const tokenMap = new Map<string, number>();
    rows.forEach(row => {
      const tokens = estimateTokens(row.primaryPrompt || '');
      tokenMap.set(row._id, tokens);
    });
    setAllPersonalityTokens(tokenMap);
  }, [rows]);

  const sorted = useMemo(() => {
    const list = [...rows]; // no filtering
    list.sort((a, b) => {
      let av: string = '';
      let bv: string = '';
      if (sortKey === 'name') {
        av = a.name || '';
        bv = b.name || '';
      } else if (sortKey === 'tenant') {
        av = tenants.find(t => t.id === a.tenantId)?.name || '';
        bv = tenants.find(t => t.id === b.tenantId)?.name || '';
      } else if (sortKey === 'used') {
        const au = a.usageCount || 0;
        const bu = b.usageCount || 0;
        const cmpUsed = au - bu;
        return sortAsc ? cmpUsed : -cmpUsed;
      } else if (sortKey === 'tokens') {
        const at = allPersonalityTokens.get(a._id) || 0;
        const bt = allPersonalityTokens.get(b._id) || 0;
        const cmpTokens = at - bt;
        return sortAsc ? cmpTokens : -cmpTokens;
      }
      const cmp = av.localeCompare(bv);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [rows, sortKey, sortAsc, tenants, allPersonalityTokens]);

  // When editing, keep a frozen order snapshot to avoid resorting jitter
  const orderedRows: PersonalityRow[] = useMemo(() => {
    if (!frozenOrderIds) return sorted;
    const map = new Map(rows.map(r => [r._id, r] as const));
    const fromFrozen = frozenOrderIds.map(id => map.get(id)).filter(Boolean) as PersonalityRow[];
    // Include any new rows that weren't in the frozen snapshot (e.g., optimistic insert)
    const frozenSet = new Set(frozenOrderIds);
    const extras = rows.filter(r => !frozenSet.has(r._id));
    return [...fromFrozen, ...extras];
  }, [sorted, rows, frozenOrderIds]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(a => !a);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const openWizardForSelected = () => {
    if (!selectedId) return;
    const sel = rowsRef.current.find(r => r._id === selectedId);
    if (!sel) return;
    setWizardTarget({
      id: sel._id,
      name: sel.name,
      tenantId: sel.tenantId,
      primaryPrompt: sel.primaryPrompt,
    });
    setWizardOpen(true);
  };

  const persistWizard = async ({ primaryPrompt }: { primaryPrompt: string }) => {
    if (!wizardTarget) return false;
    const ok = await saveField(wizardTarget.id, { primaryPrompt }, wizardTarget.tenantId);
    if (ok) {
      setRows(prev => prev.map(r => (r._id === wizardTarget.id ? { ...r, primaryPrompt } : r)));
    }
    return ok;
  };

  async function createPersonality(targetTenantId?: string) {
    const tenantId = targetTenantId || tenants[0]?.id;
    if (!tenantId) {
      toast({
        title: 'No tenants',
        description: 'Cannot create without a tenant',
        variant: 'destructive',
      });
      return;
    }
    setCreating(true);
    
    // Generate unique name
    const existingNames = rows.map(r => r.name || '');
    const baseName = 'New Personality';
    let newName = baseName;
    let counter = 2;
    const namesSet = new Set(existingNames.map(n => n.toLowerCase()));
    while (namesSet.has(newName.toLowerCase())) {
      newName = `${baseName} ${counter}`;
      counter++;
    }

    // Optimistically insert at top and enter inline edit mode
    const tempId = `temp-${Date.now()}`;
    const optimistic: PersonalityRow = {
      _id: tempId,
      name: newName,
      description: 'Edit this personality.',
      tenantId,
      primaryPrompt: 'You are a helpful assistant.',
      usageCount: 0,
    };
    // Freeze current order and put the new item at the top
    setFrozenOrderIds(prev => prev ?? [tempId, ...sorted.map(r => r._id)]);
    setRows(prev => [optimistic, ...prev]);
    setSelectedId(tempId);
  setEditingId(tempId);
  setEditingOriginalName(optimistic.name || '');
    try {
      const res = await fetch('/api/personalities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          content: {
            name: optimistic.name,
            description: optimistic.description,
            primaryPrompt: optimistic.primaryPrompt,
            variables: ['username', 'roomName', 'topic'],
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Create failed');
      }
      const data = await res.json();
      const real = data.item || data.personality || data;
      const realId = real._id || real.id;
      // Replace temp id with real id and keep editing/selection
      setRows(prev => prev.map(r => (r._id === tempId ? { ...r, _id: realId, name: real.name ?? r.name } : r)));
      setSelectedId(realId);
      setEditingId(realId);
      // Update frozen order ids to reflect real id
      setFrozenOrderIds(order => order ? [realId, ...order.filter(id => id !== tempId)] : null);
      toast({ title: 'Created', description: 'New personality created.' });
    } catch (e: any) {
      // Rollback optimistic insert
      setRows(prev => prev.filter(r => r._id !== tempId));
      setSelectedId(null);
      setEditingId(null);
      // Unfreeze order if we started editing due to create
      setFrozenOrderIds(null);
      toast({ title: 'Error', description: e?.message || 'Create failed', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  // Save a field patch for a personality, resolving the current tenantId at call time
  async function saveField(id: string, patch: Partial<PersonalityRow>, tenantOverride?: string): Promise<boolean> {
    try {
      const tenantId = tenantOverride ?? rowsRef.current.find(x => x._id === id)?.tenantId;
      if (!tenantId) throw new Error('Missing tenantId for save');
      const res = await fetch(`/api/personalities/${id}?tenantId=${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: patch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          toast({
            title: 'Name conflict',
            description: data?.error || 'Choose a different name',
            variant: 'destructive',
          });
          return false;
        }
        throw new Error(data?.error || 'Save failed');
      }
      setRows(r => r.map(row => (row._id === id ? { ...row, ...patch } : row)));
      toast({ title: 'Saved' });
      return true;
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Save failed', variant: 'destructive' });
      return false;
    }
  }

  async function deleteRow(id: string, tenantId: string) {
    if (!confirm('Delete this personality? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/personalities/${id}?tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Delete failed');
      }
      setRows(r => r.filter(x => x._id !== id));
      toast({ title: 'Deleted' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Delete failed', variant: 'destructive' });
    }
  }

  async function cloneRow(id: string, tenantId: string) {
    try {
      const res = await fetch(`/api/personalities/${id}/clone?tenantId=${tenantId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Clone failed');
      }
      toast({ title: 'Cloned' });
      await fetchAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Clone failed', variant: 'destructive' });
    }
  }

  // View history
  async function handleViewHistory(personality: PersonalityRow) {
    setHistoryPersonality(personality);
    setHistoryDialogOpen(true);
    setExpandedHistory(new Set());

    // Fetch user names for all unique user IDs in history
    if (personality.history && personality.history.length > 0) {
      const userIds = new Set(personality.history.map(entry => entry.userId));
      const newUserNames = new Map(userNames);
      
      // Fetch names for users we haven't cached yet
      const uncachedUserIds = Array.from(userIds).filter(id => !newUserNames.has(id));
      
      if (uncachedUserIds.length > 0) {
        try {
          // Fetch all users at once (superadmin endpoint)
          const res = await fetch(`/api/users/all`);
          if (res.ok) {
            const data = await res.json();
            const userMap = new Map<string, { _id: string; name?: string; email?: string }>();
            
            // Build a lookup map from the returned users
            if (data.users && Array.isArray(data.users)) {
              data.users.forEach((user: { _id: string; name?: string; email?: string }) => {
                if (user._id) {
                  userMap.set(user._id, user);
                }
              });
            }
            
            // Update cache with names for requested users
            uncachedUserIds.forEach(userId => {
              const user = userMap.get(userId);
              const name = user?.name || user?.email || userId;
              newUserNames.set(userId, name);
            });
          }
        } catch (error) {
          // Fall back to displaying userIds
          uncachedUserIds.forEach(userId => {
            newUserNames.set(userId, userId);
          });
        }
      }

      setUserNames(newUserNames);
    }
  }

  function toggleHistoryExpand(index: number) {
    setExpandedHistory(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  // --- Virtual Scroll -----------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [vsHeight, setVsHeight] = useState(600); // px
  const rowHeight = 52; // approximate collapsed row height
  const buffer = 6;
  const virtualizationEnabled = true; // no expandable rows now
  const [scrollTop, setScrollTop] = useState(0);
  // Track refs to each event prompt textarea by event key for cursor-aware insertions
  const epTextRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Update token counts when selected personality changes
  useEffect(() => {
    const sel = rows.find(r => r._id === selectedId);
    if (sel && sel.primaryPrompt) {
      const text = sel.primaryPrompt;
      setPrimaryPromptChars(text.length);
      setPrimaryPromptTokens(estimateTokens(text));
    } else {
      setPrimaryPromptChars(0);
      setPrimaryPromptTokens(0);
    }
  }, [selectedId, rows]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => setVsHeight(el.clientHeight);
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const totalRows = orderedRows.length;
  const startIndex = virtualizationEnabled ? Math.max(0, Math.floor(scrollTop / rowHeight)) : 0;
  const visibleCount = virtualizationEnabled ? Math.ceil(vsHeight / rowHeight) + buffer : totalRows;
  const endIndex = virtualizationEnabled
    ? Math.min(totalRows, startIndex + visibleCount)
    : totalRows;
  const visibleRows = virtualizationEnabled ? orderedRows.slice(startIndex, endIndex) : orderedRows;
  const offsetY = virtualizationEnabled ? startIndex * rowHeight : 0;

  return (
    <div className="space-y-6 p-4" data-hide-global-tenant-selector>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Personalities</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              disabled={creating || tenants.length === 0}
              onClick={() => createPersonality(tenants[0]?.id)}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-2">Create</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={openWizardForSelected}
              disabled={!selectedId}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Wizard
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchAll()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full">
            <div className="rounded-md border">
              <div
                ref={containerRef}
                // Vertically resizable with always-visible scrollbar
                className="h-[480px] max-h-[80vh] min-h-[260px] max-w-full resize-y overflow-y-scroll pr-1"
                onScroll={e => {
                  if (!virtualizationEnabled) return;
                  setScrollTop((e.target as HTMLDivElement).scrollTop);
                }}
              >
                <table className="personalities-table w-full min-w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '110px' }} />
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '32%' }} />
                    <col style={{ width: '80px' }} />
                    <col style={{ width: '260px' }} />
                  </colgroup>
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr className="border-b text-left">
                      <th className="px-2 py-2">ID</th>
                      <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort('name')}>
                        Name {sortKey === 'name' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort('tenant')}>
                        Tenant {sortKey === 'tenant' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="cursor-pointer"
                            onClick={() => toggleSort('used')}
                            aria-label="Sort by used count"
                          >
                            Used {sortKey === 'used' && (sortAsc ? '▲' : '▼')}
                          </button>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground cursor-help select-none">ⓘ</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[320px]">
                                This value is the count of Default Personality and Mode Personality references
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </th>
                      <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort('tokens')}>
                        Tokens {sortKey === 'tokens' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="px-2 py-2">Tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {virtualizationEnabled && offsetY > 0 && (
                      <tr style={{ height: offsetY }}>
                        <td colSpan={6} />
                      </tr>
                    )}
                    {visibleRows.map(r => {
                      return (
                        <React.Fragment key={r._id}>
                          <tr
                            className={`hover:bg-accent/30 cursor-pointer border-b transition-colors ${selectedId === r._id ? 'bg-accent/60' : ''}`}
                            onClick={e => {
                              // Avoid row click when interacting with inner controls
                              const tag = (e.target as HTMLElement).tagName;
                              if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(tag)) return;
                              setSelectedId(r._id === selectedId ? null : r._id);
                            }}
                          >
                            <td className="px-2 py-2 align-middle">
                              <span
                                className="text-muted-foreground font-mono text-[10px]"
                                title={r._id}
                              >
                                {(r._id || '').slice(0, 8)}…
                              </span>
                            </td>
                            <td className="w-[30%] px-2 py-2 align-top">
                              <Input
                                value={r.name || ''}
                                onChange={e =>
                                  setRows(curr =>
                                    curr.map(x =>
                                      x._id === r._id ? { ...x, name: e.target.value } : x
                                    )
                                  )
                                }
                                onFocus={() => {
                                  setSelectedId(r._id);
                                  setEditingId(r._id);
                                  setEditingOriginalName(r.name || '');
                                  // Snapshot current sorted order once when edit begins
                                  setFrozenOrderIds(prev => prev ?? sorted.map(x => x._id));
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    (e.currentTarget as HTMLInputElement).blur();
                                  }
                                  if (e.key === 'Escape') {
                                    // Revert the value and skip save-on-blur
                                    setRows(curr => curr.map(x => x._id === r._id ? { ...x, name: editingOriginalName } : x));
                                    skipNextSaveRef.current = r._id;
                                    setEditingId(null);
                                    setFrozenOrderIds(null);
                                    (e.currentTarget as HTMLInputElement).blur();
                                  }
                                }}
                                onBlur={async () => {
                                  if (skipNextSaveRef.current === r._id) {
                                    skipNextSaveRef.current = null;
                                    return;
                                  }
                                  const ok = await saveField(r._id, { name: r.name });
                                  if (ok && editingId === r._id) {
                                    setEditingId(null);
                                    setFrozenOrderIds(null);
                                  }
                                }}
                                autoFocus={editingId === r._id}
                                placeholder="Name"
                              />
                            </td>
                            <td className="w-[32%] px-2 py-2 align-middle">
                              <div className="flex min-h-[32px] items-center">
                                <TenantBadgeChooser
                                  tenantId={r.tenantId}
                                  tenants={tenants}
                                  onChange={val => {
                                    // Update local state first
                                    setRows(curr =>
                                      curr.map(x => (x._id === r._id ? { ...x, tenantId: val } : x))
                                    );
                                    // Persist with the new tenant immediately; use override to ensure correct URL param
                                    saveField(r._id, { tenantId: val as any }, val);
                                  }}
                                />
                              </div>
                            </td>
                            <td className="text-foreground w-[80px] px-2 py-2 align-top text-xs font-semibold">
                              {r.usageCount ?? 0}
                            </td>
                            <td className="text-foreground w-[80px] px-2 py-2 align-top text-xs font-mono">
                              ~{(allPersonalityTokens.get(r._id) || 0).toLocaleString()}
                            </td>
                            <td className="w-[260px] px-2 py-2 align-top">
                              <div className="flex flex-nowrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleViewHistory(r)}
                                  aria-label="View history"
                                  title={r.history && r.history.length > 0 ? "View history" : "No history"}
                                  className="hover:bg-accent inline-flex h-9 w-9 items-center justify-center rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={!r.history || r.history.length === 0}
                                >
                                  <History className="h-4 w-4" />
                                </button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => cloneRow(r._id, r.tenantId)}
                                >
                                  Clone
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => deleteRow(r._id, r.tenantId)}
                                  aria-label="Delete personality"
                                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                                {/* Edit button removed per request */}
                              </div>
                            </td>
                          </tr>
                          {/* Expanded edit panel removed */}
                        </React.Fragment>
                      );
                    })}
                    {virtualizationEnabled && endIndex < totalRows && (
                      <tr style={{ height: (totalRows - endIndex) * rowHeight }}>
                        <td colSpan={5} />
                      </tr>
                    )}
                    {!loading && sorted.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-muted-foreground py-6 text-center text-sm">
                          No personalities.
                        </td>
                      </tr>
                    )}
                    {loading && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          {selectedId &&
            (() => {
              const sel = rows.find(r => r._id === selectedId);
              if (!sel) return null;
              return (
                <div className="bg-muted/30 mt-6 space-y-6 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(sel._id);
                            toast({ title: 'Copied ID' });
                          } catch {
                            // ignore
                          }
                        }}
                        title="Copy personality id"
                      >
                        {sel._id}
                      </Badge>
                      <span className="text-muted-foreground">
                        Tenant: {tenants.find(t => t.id === sel.tenantId)?.name || sel.tenantId}
                      </span>
                      <span className="text-muted-foreground">Used: {sel.usageCount ?? 0}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
                        Close
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">Primary Prompt</span>
                        <Badge
                          role="button"
                          tabIndex={0}
                          onClick={selectedId ? openWizardForSelected : undefined}
                          onKeyDown={e => {
                            if (!selectedId) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openWizardForSelected();
                            }
                          }}
                          className={`cursor-pointer ${selectedId ? 'bg-amber-100 text-amber-900 hover:bg-amber-200' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}
                          aria-disabled={!selectedId}
                          title={selectedId ? 'Open wizard' : 'Select a personality to open wizard'}
                        >
                          <Wand2 className="mr-1 h-3 w-3" />
                          Wizard
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {primaryPromptChars} chars • ~{primaryPromptTokens} tokens
                      </span>
                    </div>
                    <textarea
                      className="bg-background min-h-[140px] w-full rounded border p-2 text-sm"
                      value={sel.primaryPrompt || ''}
                      onChange={e => {
                        const newValue = e.target.value;
                        setPrimaryPromptChars(newValue.length);
                        setPrimaryPromptTokens(estimateTokens(newValue));
                        setRows(curr =>
                          curr.map(x =>
                            x._id === sel._id ? { ...x, primaryPrompt: newValue } : x
                          )
                        );
                      }}
                      onBlur={() => saveField(sel._id, { primaryPrompt: sel.primaryPrompt })}
                      placeholder="You are a helpful assistant..."
                    />
                  </div>

                  {/* RETIRED - Event System Prompts Section */}

                  {/* Beats Section - DISABLED FOR NOW *****
                  <div className="mt-6">
                    <h4 className="mb-3 text-sm font-medium">Conversation Beats</h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Schedule specific messages to be sent at certain times during the conversation.
                    </p>
                    {(sel.beats || []).map((beat: any, idx: number) => (
                      <div key={idx} className="mb-3 rounded border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium">Beat {idx + 1}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const updated = [...(sel.beats || [])];
                              updated.splice(idx, 1);
                              setRows(curr =>
                                curr.map(x =>
                                  x._id === sel._id ? { ...x, beats: updated } : x
                                )
                              );
                              saveField(sel._id, { beats: updated as any });
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="mb-2">
                          <label className="text-xs text-muted-foreground">Start Time (seconds)</label>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            className="mt-1 h-8 text-xs"
                            value={beat.start_time || 0}
                            onChange={e => {
                              const updated = [...(sel.beats || [])];
                              updated[idx] = {
                                ...updated[idx],
                                start_time: parseFloat(e.target.value) || 0,
                              };
                              setRows(curr =>
                                curr.map(x =>
                                  x._id === sel._id ? { ...x, beats: updated } : x
                                )
                              );
                            }}
                            onBlur={() =>
                              saveField(sel._id, { beats: sel.beats as any })
                            }
                          />
                        </div>
                        <div className="mb-2">
                          <label className="text-xs text-muted-foreground">Message</label>
                          <textarea
                            className="bg-background mt-1 min-h-[60px] w-full rounded border p-2 text-xs"
                            value={beat.message || ''}
                            onChange={e => {
                              const updated = [...(sel.beats || [])];
                              updated[idx] = {
                                ...updated[idx],
                                message: e.target.value,
                              };
                              setRows(curr =>
                                curr.map(x =>
                                  x._id === sel._id ? { ...x, beats: updated } : x
                                )
                              );
                            }}
                            onBlur={() =>
                              saveField(sel._id, { beats: sel.beats as any })
                            }
                            placeholder="Enter the message to send at this time..."
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const updated = [...(sel.beats || []), { message: '', start_time: 0 }];
                        setRows(curr =>
                          curr.map(x => (x._id === sel._id ? { ...x, beats: updated } : x))
                        );
                        saveField(sel._id, { beats: updated as any });
                      }}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add Beat
                    </Button>
                  </div> ******/}
                </div>
              );
            })()}
        </CardContent>
      </Card>

      {/* History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono">
              History: {historyPersonality?.name || 'Personality'}
            </DialogTitle>
            <DialogDescription>
              View changes made to this personality over time
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            {historyPersonality?.history && historyPersonality.history.length > 0 ? (
              <div className="space-y-4">
                {historyPersonality.history.map((entry, index) => {
                  const isExpanded = expandedHistory.has(index);
                  const userName = userNames.get(entry.userId) || entry.userId;
                  return (
                    <Card key={index}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium">
                              Revision #{historyPersonality.history!.length - index}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Modified by <span className="font-medium">{userName}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(entry.modifiedAt).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleHistoryExpand(index)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </CardHeader>
                      {isExpanded && (
                        <CardContent>
                          <pre className="text-xs font-mono bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap break-words">
                            {entry.delta}
                          </pre>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                No history available
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PersonalityWizardDialog
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          setWizardTarget(null);
        }}
        target={wizardTarget}
        onPersist={persistWizard}
      />
    </div>
  );
}

let EventIds: readonly string[] | undefined = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  EventIds = require('@nia/events').EventIds as string[];
} catch {
  // ignore
}

function TenantBadgeChooser({
  tenantId,
  tenants,
  onChange,
}: {
  tenantId: string;
  tenants: Tenant[];
  onChange: (id: string) => void;
}) {
  const current = tenants.find(t => t.id === tenantId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className="max-w-full cursor-pointer truncate"
          title={current?.name || tenantId}
        >
          {current?.name || tenantId}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="max-h-64 overflow-y-auto text-sm">
          {tenants.map(t => (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`hover:bg-accent/50 w-full px-3 py-2 text-left ${t.id === tenantId ? 'bg-accent/30 font-medium' : ''}`}
            >
              {t.name || t.id}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
