'use client';

import { getAllRegisteredTools, getFeatureKeysWithPrompts } from '@nia/features';
import { Plus, Save, Trash2, X, History, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState, useRef, useMemo } from 'react';

import { Button } from '@dashboard/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dashboard/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@dashboard/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/components/ui/select';
import { Textarea } from '@dashboard/components/ui/textarea';
import { useToast } from '@dashboard/hooks/use-toast';

export const dynamic = 'force-dynamic';

// Rough token estimation: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface IFunctionalPrompt {
  _id: string;
  featureKey: string;
  promptContent: string;
  lastModifiedByUserId?: string;
  history?: Array<{
    userId: string;
    delta: string;
    modifiedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

type ViewMode = 'list' | 'edit' | 'create';

// Get feature keys that have associated functional prompts, plus desktopSwitching (built-in feature)
// and note tool keys (special cases for customizing bot note tool descriptions)
const AVAILABLE_FEATURE_KEYS = [
  ...getFeatureKeysWithPrompts(), 
  ...getAllRegisteredTools(),
  'desktopSwitching',
].sort();

export default function FunctionalPromptsAdminPage() {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<IFunctionalPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyPrompt, setHistoryPrompt] = useState<IFunctionalPrompt | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());

  // Form state for create/edit
  const [formData, setFormData] = useState({ featureKey: '', promptContent: '' });
  
  // Token/character counting
  const [promptCounts, setPromptCounts] = useState<Map<string, { chars: number; tokens: number }>>(new Map());
  const [createFormChars, setCreateFormChars] = useState(0);
  const [createFormTokens, setCreateFormTokens] = useState(0);
  
  // Refs for autosave
  const contentRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  // Calculate total tokens for all bot_ functional prompts
  const totalBotTokens = useMemo(() => {
    let total = 0;
    prompts.forEach((p) => {
      if (p.featureKey.startsWith('bot_')) {
        const count = promptCounts.get(p._id);
        if (count) {
          total += count.tokens;
        }
      }
    });
    return total;
  }, [prompts, promptCounts]);

  // Load all prompts
  useEffect(() => {
    let cancelled = false;

    async function loadPrompts() {
      setLoading(true);
      try {
        const res = await fetch('/api/functionalPrompt');
        if (!res.ok) throw new Error('Failed to load functional prompts');
        const data = await res.json();
        if (!cancelled) {
          // API returns PrismContentResult with items array
          setPrompts(data.items || []);
          // Initialize token counts for all prompts
          const counts = new Map<string, { chars: number; tokens: number }>();
          (data.items || []).forEach((p: IFunctionalPrompt) => {
            const text = p.promptContent || '';
            counts.set(p._id, { chars: text.length, tokens: estimateTokens(text) });
          });
          setPromptCounts(counts);
        }
      } catch (err) {
        if (!cancelled) {
          toast({
            title: 'Error',
            description: err instanceof Error ? err.message : 'Failed to load prompts',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPrompts();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Autosave on blur
  const handleBlur = async (prompt: IFunctionalPrompt) => {
    const textarea = contentRefs.current.get(prompt._id);
    if (!textarea) return;

    const newContent = textarea.value;
    if (newContent === prompt.promptContent) return; // No changes

    setSaving(true);
    try {
      const res = await fetch('/api/functionalPrompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureKey: prompt.featureKey,
          promptContent: newContent,
        }),
      });

      if (!res.ok) throw new Error('Failed to save prompt');

      const updatedPrompt = await res.json();
      setPrompts(prev =>
        prev.map(p => (p._id === prompt._id ? updatedPrompt : p))
      );

      toast({
        title: 'Saved',
        description: `Updated "${prompt.featureKey}"`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save prompt',
        variant: 'destructive',
      });
      // Revert on error
      if (textarea) textarea.value = prompt.promptContent;
    } finally {
      setSaving(false);
    }
  };

  // Create new prompt
  const handleCreate = async () => {
    if (!formData.featureKey.trim() || !formData.promptContent.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Feature key and content are required',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/functionalPrompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error('Failed to create prompt');

      const newPrompt = await res.json();
      setPrompts(prev => [...prev, newPrompt]);
      setFormData({ featureKey: '', promptContent: '' });
      setViewMode('list');

      toast({
        title: 'Created',
        description: `Created "${formData.featureKey}"`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to create prompt',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Delete prompt
  const handleDelete = async (prompt: IFunctionalPrompt) => {
    if (!confirm(`Delete "${prompt.featureKey}"?`)) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/functionalPrompt?featureKey=${encodeURIComponent(prompt.featureKey)}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete prompt');

      setPrompts(prev => prev.filter(p => p._id !== prompt._id));

      toast({
        title: 'Deleted',
        description: `Deleted "${prompt.featureKey}"`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete prompt',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // View history
  const handleViewHistory = async (prompt: IFunctionalPrompt) => {
    setHistoryPrompt(prompt);
    setHistoryDialogOpen(true);
    setExpandedHistory(new Set());

    // Fetch user names for all unique user IDs in history
    if (prompt.history && prompt.history.length > 0) {
      const userIds = new Set(prompt.history.map(entry => entry.userId));
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
          console.warn('Failed to fetch users:', error);
          // Fall back to displaying userIds
          uncachedUserIds.forEach(userId => {
            newUserNames.set(userId, userId);
          });
        }
      }

      setUserNames(newUserNames);
    }
  };

  const toggleHistoryExpand = (index: number) => {
    setExpandedHistory(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-muted-foreground">Loading functional prompts...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">Functional Prompts</h1>
          {viewMode === 'list' && (
            <Button onClick={() => setViewMode('create')}>
              <Plus className="mr-2 h-4 w-4" />
              New Prompt
            </Button>
          )}
          {viewMode === 'create' && (
            <Button variant="outline" onClick={() => setViewMode('list')}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>
        <p className="text-muted-foreground">
          Manage dynamic system prompts for various features. Edit inline and changes save automatically on blur.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm font-medium">Total Bot Tokens:</span>
          <span className="text-sm font-mono bg-primary/10 px-2 py-1 rounded">
            ~{totalBotTokens.toLocaleString()} tokens
          </span>
          <span className="text-xs text-muted-foreground">
            (sum of all bot_* functional prompts)
          </span>
        </div>
      </div>

      {viewMode === 'create' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New Functional Prompt</CardTitle>
            <CardDescription>
              Select a feature key and enter the prompt content
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Feature Key</label>
              <label className="text-sm font-small mb-1.5 block">(not all features require/use prompts)</label>
              <Select
                value={formData.featureKey}
                onValueChange={value => setFormData(prev => ({ ...prev, featureKey: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a feature..." />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_FEATURE_KEYS.map(key => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Choose from predefined feature keys
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">Prompt Content</label>
                <span className="text-xs text-muted-foreground">
                  {createFormChars} chars • ~{createFormTokens} tokens
                </span>
              </div>
              <Textarea
                placeholder="Enter the functional prompt content..."
                value={formData.promptContent}
                onChange={e => {
                  const newValue = e.target.value;
                  setCreateFormChars(newValue.length);
                  setCreateFormTokens(estimateTokens(newValue));
                  setFormData(prev => ({ ...prev, promptContent: newValue }));
                }}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Creating...' : 'Create Prompt'}
              </Button>
              <Button variant="outline" onClick={() => setViewMode('list')}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === 'list' && (
        <div className="space-y-4">
          {prompts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No functional prompts yet. Click &ldquo;New Prompt&rdquo; to create one.
              </CardContent>
            </Card>
          ) : (
            prompts
              .sort((a, b) => a.featureKey.localeCompare(b.featureKey))
              .map(prompt => {
                const isExpanded = expandedCardId === prompt._id;
                return (
                  <Card key={prompt._id}>
                    <CardHeader 
                      className="cursor-pointer hover:bg-accent/30 transition-colors"
                      onClick={() => setExpandedCardId(isExpanded ? null : prompt._id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="font-mono text-lg flex items-center gap-2">
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {prompt.featureKey}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Last updated: {new Date(prompt.updatedAt).toLocaleString()}
                            {prompt.history && prompt.history.length > 0 && (
                              <span className="ml-2">• {prompt.history.length} revision{prompt.history.length !== 1 ? 's' : ''}</span>
                            )}
                          </CardDescription>
                        </div>
                        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewHistory(prompt)}
                            title={prompt.history && prompt.history.length > 0 ? "View history" : "No history yet"}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(prompt)}
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">
                            {promptCounts.get(prompt._id)?.chars ?? 0} chars • ~{promptCounts.get(prompt._id)?.tokens ?? 0} tokens
                          </span>
                        </div>
                        <Textarea
                          ref={el => {
                            if (el) contentRefs.current.set(prompt._id, el);
                          }}
                          defaultValue={prompt.promptContent}
                          onChange={e => {
                            const newValue = e.target.value;
                            setPromptCounts(prev => {
                              const next = new Map(prev);
                              next.set(prompt._id, { chars: newValue.length, tokens: estimateTokens(newValue) });
                              return next;
                            });
                          }}
                          onBlur={() => handleBlur(prompt)}
                          rows={Math.max(10, Math.ceil(prompt.promptContent.split('\n').length * 1.2))}
                          className="font-mono text-sm resize-y"
                          placeholder="Enter prompt content..."
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          💡 Changes save automatically when you click outside the text area
                        </p>
                      </CardContent>
                    )}
                  </Card>
                );
              })
          )}
        </div>
      )}

      {/* History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono">
              History: {historyPrompt?.featureKey}
            </DialogTitle>
            <DialogDescription>
              View changes made to this prompt over time
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            {historyPrompt?.history && historyPrompt.history.length > 0 ? (
              <div className="space-y-4">
                {historyPrompt.history.map((entry, index) => {
                  const isExpanded = expandedHistory.has(index);
                  const userName = userNames.get(entry.userId) || entry.userId;
                  return (
                    <Card key={index}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium">
                              Revision #{historyPrompt.history!.length - index}
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
    </div>
  );
}
