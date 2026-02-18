/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { diffLines, diffWordsWithSpace } from 'diff';
import { ChevronDown, ChevronUp, Loader2, Wand2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@dashboard/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dashboard/components/ui/dialog';
import { Input } from '@dashboard/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dashboard/components/ui/tabs';
import { Textarea } from '@dashboard/components/ui/textarea';
import { useToast } from '@dashboard/hooks/use-toast';

import {
  WizardBeat,
  WizardState,
  buildWizardState,
  normalizeRevisedPrompt,
  parseWizardPrompt,
  reorderBeat,
  serializeWizardState,
} from './wizard_logic';

const BEAT_BORDER_CLASSES = [
  'border-red-500',
  'border-orange-500',
  'border-amber-500',
  'border-yellow-400',
  'border-lime-500',
  'border-green-500',
  'border-emerald-500',
  'border-teal-500',
  'border-cyan-500',
  'border-sky-500',
  'border-blue-500',
  'border-indigo-500',
  'border-violet-500',
  'border-fuchsia-500',
  'border-pink-500',
  'border-rose-500',
];

export interface WizardTarget {
  id: string;
  name?: string;
  tenantId: string;
  primaryPrompt?: string | null;
  beats?: Array<{ message: string; start_time?: number } | null> | null;
}

interface ReviewResult {
  revisedPrompt: string;
  explanation?: string;
  diff: Array<{ type: 'add' | 'remove' | 'context'; value: string }>;
  parsed?: WizardState;
}

interface ExplanationEntry {
  raw: string;
  section?: string;
  before?: string;
  after?: string;
  why?: string;
}

interface PersonalityWizardDialogProps {
  open: boolean;
  onClose: () => void;
  target: WizardTarget | null;
  onPersist: (payload: { primaryPrompt: string }) => Promise<boolean>;
}

const TOOL_APPX = `Authoring rules:
- Section order: PERSONALITY → TONE/VOICE (opt) → AVAILABLE TOOLS (opt) → RULES → SEQUENCE LOGIC → PRIMARY OBJECTIVE → BEATs
- One goal per beat, numbered, concise
- Keep transitions clear and avoid duplication

Directive markers (use instead of // comments):
- [SPEAK] - Text the assistant should say
- [WAIT FOR RESPONSE] - Pause for user input
- [THEN] - Sequential action
- [TOOL CALL] - Tool invocation (include tool name and params)
- [IF] / [ELSE] - Conditional branches
- [CHECK] - State verification
- [GOAL] - Beat goal statement

CRITICAL: Tool calls must NOT precede user greeting unless explicitly required by the prompt.

Known tools: bot_update_user_profile, bot_switch_desktop_mode, bot_load_html_applet, bot_onboarding_complete, summarize, search, calendar, notify_user`;

function toLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function buildReviewPrompt(state: WizardState): Record<string, unknown> {
  // Build payload in optimized order for LLM consumption
  const payload: Record<string, unknown> = {
    PERSONALITY: state.personality.trim(),
  };
  
  // Include tone/voice if populated
  if (state.toneVoice?.trim()) {
    payload['TONE / VOICE'] = state.toneVoice.trim();
  }
  
  payload.RULES = toLines(state.rules);
  payload['SEQUENCE LOGIC'] = toLines(state.sequenceLogic);
  payload['PRIMARY OBJECTIVE'] = state.primaryObjective.trim();

  state.beats.forEach((beat, idx) => {
    payload[`BEAT ${idx + 1}`] = {
      GOAL: (beat.goal || '').toString().trim(),
      BODY: (beat.body || '').toString().trim(),
    };
  });

  return payload;
}

function toDisplayText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(toDisplayText).join('\n');
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function cloneWizardState(state: WizardState): WizardState {
  return {
    personality: state.personality,
    toneVoice: state.toneVoice,
    rules: state.rules,
    sequenceLogic: state.sequenceLogic,
    primaryObjective: state.primaryObjective,
    beats: state.beats.map(beat => ({ ...beat })),
  };
}

function sectionsEqual(a: string | undefined, b: string | undefined): boolean {
  return (a || '').trim() === (b || '').trim();
}

function beatsEqual(a: WizardBeat | undefined, b: WizardBeat | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return sectionsEqual(a.goal, b.goal) && sectionsEqual(a.body, b.body);
}

function mergeReworkWithCachedSuggestions(params: {
  rework: WizardState;
  baseline: WizardState | null;
  cachedSuggestion: WizardState | null;
}): WizardState {
  const { rework, baseline, cachedSuggestion } = params;
  if (!baseline || !cachedSuggestion) return rework;

  const merged: WizardState = {
    personality: sectionsEqual(rework.personality, baseline.personality)
      ? cachedSuggestion.personality
      : rework.personality,
    toneVoice: sectionsEqual(rework.toneVoice, baseline.toneVoice)
      ? cachedSuggestion.toneVoice
      : rework.toneVoice,
    rules: sectionsEqual(rework.rules, baseline.rules) ? cachedSuggestion.rules : rework.rules,
    sequenceLogic: sectionsEqual(rework.sequenceLogic, baseline.sequenceLogic)
      ? cachedSuggestion.sequenceLogic
      : rework.sequenceLogic,
    primaryObjective: sectionsEqual(rework.primaryObjective, baseline.primaryObjective)
      ? cachedSuggestion.primaryObjective
      : rework.primaryObjective,
    beats: [],
  };

  const maxBeats = Math.max(rework.beats.length, baseline.beats.length, cachedSuggestion.beats.length);
  for (let i = 0; i < maxBeats; i += 1) {
    const reworkBeat = rework.beats[i];
    const baselineBeat = baseline.beats[i];
    const cachedBeat = cachedSuggestion.beats[i];
    const useCached = beatsEqual(reworkBeat, baselineBeat) && cachedBeat;
    const picked = useCached ? cachedBeat : reworkBeat;
    if (picked) {
      merged.beats.push({ ...picked, title: `BEAT ${merged.beats.length + 1}` });
    }
  }

  return merged;
}
function renderDiffBlocks(source: string | unknown, revised: string | unknown, role: 'current' | 'suggested') {
  const sourceText = toDisplayText(source);
  const revisedText = toDisplayText(revised);

  if ((typeof source === 'object' && source !== null) || (typeof revised === 'object' && revised !== null)) {
    // eslint-disable-next-line no-console
    console.info('[wizard review diff] non-string input detected', { role, sourceType: typeof source, revisedType: typeof revised });
  }

  const parts = diffWordsWithSpace(sourceText, revisedText);
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/80 p-2 font-mono text-[12px] leading-5 whitespace-pre-wrap break-words">
      {parts.map((part, idx) => {
        if (role === 'current' && part.added) return null;
        if (role === 'suggested' && part.removed) return null;

        const base = 'px-0.5';
        const cls = role === 'current'
          ? part.removed
            ? `${base} bg-rose-900/70 text-rose-50`
            : `${base} text-slate-50`
          : part.added
            ? `${base} bg-emerald-900/70 text-emerald-50`
            : `${base} text-slate-50`;

        return (
          <span key={idx} className={cls}>
            {part.value || ' '}
          </span>
        );
      })}
    </div>
  );
}

function SectionDiff({
  label,
  current,
  suggested,
  selection,
  onSelect,
  disabled = false,
}: {
  label: string;
  current: string;
  suggested: string;
  selection: boolean;
  onSelect: (value: boolean) => void;
  disabled?: boolean;
}) {
  const currentText = toDisplayText(current);
  const suggestedText = toDisplayText(suggested);
  const noChanges = currentText === suggestedText;
  const effectiveSelection = noChanges ? false : selection;
  const currentHighlighted = !effectiveSelection;
  const suggestedHighlighted = effectiveSelection;
  const frameBase = 'rounded-md border bg-slate-950/80 p-3 flex flex-col gap-2';
  const currentFrameClass = currentHighlighted ? `${frameBase} border-amber-400/80` : `${frameBase} border-slate-800`;
  const suggestedFrameClass = suggestedHighlighted ? `${frameBase} border-emerald-400/80` : `${frameBase} border-slate-800`;
  const headerBase = 'min-h-[36px] text-[11px] font-semibold uppercase tracking-wide text-slate-300 flex items-center justify-between';
  const scrollBase = 'max-h-[260px] overflow-y-auto rounded border bg-slate-900/80 p-1';
  const currentScrollClass = currentHighlighted ? `${scrollBase} border-amber-400/70` : `${scrollBase} border-slate-800`;
  const suggestedScrollClass = suggestedHighlighted ? `${scrollBase} border-emerald-400/70` : `${scrollBase} border-slate-800`;

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-100">
        <span className="uppercase tracking-wide text-[11px] text-slate-300">{label}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={currentFrameClass}>
          <div className={headerBase}>
            <span>Current</span>
          </div>
          <div className={currentScrollClass}>
            {renderDiffBlocks(current, suggested, 'current')}
          </div>
        </div>
        <div className={suggestedFrameClass}>
          <div className={headerBase}>
            <span className="flex items-center gap-2">
              <span>Suggested</span>
              <span
                className={
                  effectiveSelection
                    ? 'rounded-full bg-emerald-900/70 px-2 py-1 text-[10px] font-bold text-emerald-50'
                    : noChanges
                      ? 'rounded-full bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-100'
                      : 'rounded-full bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-100'
                }
              >
                {noChanges ? 'No changes' : effectiveSelection ? 'Accepted' : 'Rejected'}
              </span>
            </span>
            {noChanges ? (
              <span className="text-[10px] font-medium text-slate-300">No changes needed</span>
            ) : (
              <div className="flex items-center gap-1 text-[10px] font-bold">
                <Button
                  size="sm"
                  variant={effectiveSelection ? 'outline' : 'secondary'}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onSelect(false);
                  }}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant={effectiveSelection ? 'secondary' : 'outline'}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onSelect(true);
                  }}
                >
                  Accept
                </Button>
              </div>
            )}
          </div>
          <div className={suggestedScrollClass}>
            {renderDiffBlocks(current, suggested, 'suggested')}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildSectionDiffs(current: WizardState, suggested: WizardState) {
  const sections = [
    {
      key: 'personality',
      label: 'Personality',
      current: toDisplayText(current.personality),
      suggested: toDisplayText(suggested.personality),
    },
    {
      key: 'toneVoice',
      label: 'Tone / Voice',
      current: toDisplayText(current.toneVoice),
      suggested: toDisplayText(suggested.toneVoice),
    },
    {
      key: 'rules',
      label: 'Rules',
      current: toDisplayText(current.rules),
      suggested: toDisplayText(suggested.rules),
    },
    {
      key: 'sequenceLogic',
      label: 'Sequence Logic',
      current: toDisplayText(current.sequenceLogic),
      suggested: toDisplayText(suggested.sequenceLogic),
    },
    {
      key: 'primaryObjective',
      label: 'Primary Objective',
      current: toDisplayText(current.primaryObjective),
      suggested: toDisplayText(suggested.primaryObjective),
    },
  ];

  const maxBeats = Math.max(current.beats.length, suggested.beats.length);
  for (let i = 0; i < maxBeats; i += 1) {
    const curBeatParts = [
      current.beats[i]?.goal ? `Goal: ${toDisplayText(current.beats[i]?.goal)}` : null,
      current.beats[i]?.body ? toDisplayText(current.beats[i]?.body) : '',
    ]
      .filter(Boolean)
      .join('\n');
    const sugBeatParts = [
      suggested.beats[i]?.goal ? `Goal: ${toDisplayText(suggested.beats[i]?.goal)}` : null,
      suggested.beats[i]?.body ? toDisplayText(suggested.beats[i]?.body) : '',
    ]
      .filter(Boolean)
      .join('\n');
    sections.push({
      key: `beat-${i}`,
      label: `Beat ${i + 1}`,
      current: curBeatParts,
      suggested: sugBeatParts,
    });
  }

  return sections;
}

function mergeWizardStateWithSelections(
  current: WizardState,
  suggested: WizardState,
  selections: Record<string, boolean>,
): WizardState {
  const next: WizardState = {
    personality: selections.personality ? suggested.personality : current.personality,
    toneVoice: selections.toneVoice ? suggested.toneVoice : current.toneVoice,
    rules: selections.rules ? suggested.rules : current.rules,
    sequenceLogic: selections.sequenceLogic ? suggested.sequenceLogic : current.sequenceLogic,
    primaryObjective: selections.primaryObjective ? suggested.primaryObjective : current.primaryObjective,
    beats: [],
  };

  const maxBeats = Math.max(current.beats.length, suggested.beats.length);
  for (let i = 0; i < maxBeats; i += 1) {
    const useSuggested = selections[`beat-${i}`];
    const source = useSuggested ? suggested.beats[i] : current.beats[i];
    if (!source) continue;
    const id = source.id || `beat-${Date.now()}-${i}-${useSuggested ? 's' : 'c'}`;
    next.beats.push({ ...source, id, title: `BEAT ${next.beats.length + 1}` });
  }

  return next;
}

export function PersonalityWizardDialog({ open, onClose, target, onPersist }: PersonalityWizardDialogProps) {
  const { toast } = useToast();
  const seed = useMemo(() => buildWizardState(target?.primaryPrompt || ''), [target]);
  const [wizardState, setWizardState] = useState<WizardState>(seed.state);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [activeTab, setActiveTab] = useState('personality');
  const [reviewTabDirty, setReviewTabDirty] = useState(false);
  const [sectionSelections, setSectionSelections] = useState<Record<string, boolean>>({});
  const [beatColors, setBeatColors] = useState<Record<string, number>>({});
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkRequest, setReworkRequest] = useState('');
  const [isExplanationOpen, setIsExplanationOpen] = useState(true);
  const nextBeatColorRef = useRef(0);
  const autoReviewTriggeredRef = useRef<string | null>(null);
  const lastSuggestionsRef = useRef<WizardState | null>(null);
  const lastSuggestionsBaselineRef = useRef<WizardState | null>(null);
  const pendingReworkMergeRef = useRef<{ baseline: WizardState; cachedSuggestion: WizardState | null } | null>(null);
  // Track which personality ID the in-memory review belongs to (not just boolean)
  const reviewResultPersonalityIdRef = useRef<string | null>(null);
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [cacheChecked, setCacheChecked] = useState(false);

  const hasReviewableContent = useMemo(() => {
    const fields = [
      wizardState.personality,
      wizardState.rules,
      wizardState.sequenceLogic,
      wizardState.primaryObjective,
    ];
    const hasBeatContent = wizardState.beats.some(
      beat => (beat.goal || '').trim().length > 0 || (beat.body || '').trim().length > 0,
    );
    return fields.some(val => (val || '').trim().length > 0) || hasBeatContent;
  }, [wizardState]);

  // Persist the latest review + suggestion cache when dialog closes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (open) return;
    if (!target || !reviewResult) return;
    const payload = {
      reviewResult,
      lastSuggestions: lastSuggestionsRef.current,
      lastBaseline: lastSuggestionsBaselineRef.current,
    };
    try {
      console.info('[wizard dialog] cache write', {
        personalityId: target.id,
        hasSuggestions: Boolean(payload.lastSuggestions),
        hasBaseline: Boolean(payload.lastBaseline),
        hasReviewResult: Boolean(payload.reviewResult),
      });
      window.localStorage.setItem(`wizard-review-cache:${target.id}`, JSON.stringify(payload));
    } catch {
      // Best effort: ignore storage failures
    }
  }, [open, reviewResult, target]);

  // Restore cached review when opening the dialog
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!open || !target) return;
    setRestoredFromCache(false);
    setCacheChecked(false);
    try {
      const raw = window.localStorage.getItem(`wizard-review-cache:${target.id}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        reviewResult?: ReviewResult;
        lastSuggestions?: WizardState | null;
        lastBaseline?: WizardState | null;
      };
      if (parsed?.reviewResult) {
        console.info('[wizard dialog] cache restore hit', {
          personalityId: target.id,
          hasSuggestions: Boolean(parsed.lastSuggestions),
          hasBaseline: Boolean(parsed.lastBaseline),
        });
        setReviewResult(parsed.reviewResult);
        if (parsed.lastSuggestions) lastSuggestionsRef.current = parsed.lastSuggestions;
        if (parsed.lastBaseline) lastSuggestionsBaselineRef.current = parsed.lastBaseline;
        autoReviewTriggeredRef.current = target.id; // prevent immediate auto-review when cache exists
        setRestoredFromCache(true);
      }
    } catch {
      // ignore malformed cache
    } finally {
      setCacheChecked(true);
    }
  }, [open, target]);

  useEffect(() => {
    // Track which personality the review result belongs to
    if (reviewResult && target?.id) {
      reviewResultPersonalityIdRef.current = target.id;
    } else if (!reviewResult) {
      reviewResultPersonalityIdRef.current = null;
    }
  }, [reviewResult, target?.id]);

  const suggestedState = reviewResult?.parsed || (reviewResult ? parseWizardPrompt(reviewResult.revisedPrompt).state : null);
  const sectionDiffs = useMemo(
    () => (suggestedState ? buildSectionDiffs(wizardState, suggestedState) : []),
    [suggestedState, wizardState],
  );
  const explanationEntries = useMemo(() => {
    const raw = reviewResult?.explanation || '';
    return raw
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map<ExplanationEntry>(line => {
        const entry: ExplanationEntry = { raw: line };
        const parts = line.split('|').map(part => part.trim());
        parts.forEach(part => {
          const match = part.match(/^([A-Za-z\s]+):\s*(.*)$/);
          if (!match) return;
          const label = match[1].toLowerCase().trim();
          const value = match[2].trim();
          if (label.startsWith('section')) entry.section = value;
          else if (label.startsWith('before')) entry.before = value;
          else if (label.startsWith('after')) entry.after = value;
          else if (label.startsWith('why')) entry.why = value;
        });
        return entry;
      });
  }, [reviewResult?.explanation]);

  useEffect(() => {
    if (!open) return;

    const seeded = buildWizardState(target?.primaryPrompt || '');
    setWizardState(seeded.state);
    setActiveTab('personality');
    setSectionSelections({});
    // Check if in-memory review is for THIS personality (not a different one)
    const hasInMemoryReviewForThisPersonality = 
      reviewResultPersonalityIdRef.current === target?.id && reviewResultPersonalityIdRef.current !== null;
    autoReviewTriggeredRef.current = hasInMemoryReviewForThisPersonality && target ? target.id : restoredFromCache && target ? target.id : null;

    const initialColors: Record<string, number> = {};
    let nextColor = 0;
    seeded.state.beats.forEach(beat => {
      initialColors[beat.id] = nextColor;
      nextColor = (nextColor + 1) % BEAT_BORDER_CLASSES.length;
    });
    nextBeatColorRef.current = nextColor;
    setBeatColors(initialColors);

    // Clear review if not restored from cache AND no in-memory review for THIS personality
    if (!restoredFromCache && !hasInMemoryReviewForThisPersonality) {
      setReviewResult(null);
      lastSuggestionsRef.current = null;
      lastSuggestionsBaselineRef.current = null;
      reviewResultPersonalityIdRef.current = null;
    }

    console.info('[wizard dialog] reset on open', {
      personalityId: target?.id,
      restoredFromCache,
      autoReviewTriggered: autoReviewTriggeredRef.current,
      hasInMemoryReviewForThisPersonality,
      reviewResultPersonalityId: reviewResultPersonalityIdRef.current,
    });
  }, [target, open, restoredFromCache]);

  useEffect(() => {
    setBeatColors(prev => {
      let nextColor = nextBeatColorRef.current;
      const nextMap: Record<string, number> = {};
      let changed = false;

      wizardState.beats.forEach(beat => {
        const prior = prev[beat.id];
        if (prior !== undefined) {
          nextMap[beat.id] = prior;
        } else {
          nextMap[beat.id] = nextColor;
          nextColor = (nextColor + 1) % BEAT_BORDER_CLASSES.length;
          changed = true;
        }
      });

      if (Object.keys(nextMap).length !== Object.keys(prev).length) {
        changed = true;
      }

      nextBeatColorRef.current = nextColor;
      return changed ? nextMap : prev;
    });
  }, [wizardState.beats]);

  useEffect(() => {
    if (!reviewResult) {
      setReviewTabDirty(false);
      return;
    }
    setReviewTabDirty(activeTab !== 'review');
  }, [reviewResult, activeTab]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'review') {
      setReviewTabDirty(false);
    }
  };

  useEffect(() => {
    if (!reviewResult || !suggestedState || !sectionDiffs.length) return;
    setSectionSelections(() => {
      const next: Record<string, boolean> = {};
      sectionDiffs.forEach(section => {
        next[section.key] = false;
      });
      return next;
    });
    const diagnostics = sectionDiffs.map(section => {
      const suggestedText = toDisplayText(section.suggested);
      return {
        key: section.key,
        label: section.label,
        suggestedType: typeof section.suggested,
        suggestedLength: suggestedText.length,
        suggestedPreview: suggestedText.slice(0, 200),
        currentLength: toDisplayText(section.current).length,
      };
    });
    const beatDiagnostics = suggestedState.beats.map((beat, idx) => ({
      idx: idx + 1,
      title: beat.title,
      goalType: typeof beat.goal,
      goalLength: (beat.goal || '').length,
      goalPreview: toDisplayText(beat.goal || '').slice(0, 200),
      bodyType: typeof beat.body,
      bodyLength: (beat.body || '').length,
      bodyPreview: toDisplayText(beat.body || '').slice(0, 200),
    }));
    // eslint-disable-next-line no-console
    console.info('[wizard review] suggested section payloads', {
      sections: diagnostics,
      beats: beatDiagnostics,
      reviewPromptLength: reviewResult.revisedPrompt?.length,
    });
  }, [reviewResult, sectionDiffs, suggestedState]);

  const serialized = useMemo(() => serializeWizardState(wizardState), [wizardState]);
  const reviewPromptPayload = useMemo(() => buildReviewPrompt(wizardState), [wizardState]);

  useEffect(() => {
    if (!open || !target) return;
    if (!cacheChecked) return; // wait until cache restore attempt completes
    if (reviewing) return;
    if (restoredFromCache && reviewResult) return;
    if (!hasReviewableContent) return;
    const alreadyTriggered = autoReviewTriggeredRef.current === target.id;
    if (alreadyTriggered) {
      console.info('[wizard dialog] auto-review skipped (already triggered)', {
        personalityId: target.id,
        restoredFromCache,
        hasReviewResult: Boolean(reviewResult),
        reviewing,
        cacheChecked,
        hasReviewableContent,
        autoReviewTriggered: autoReviewTriggeredRef.current,
      });
      return;
    }
    console.info('[wizard dialog] auto-review firing', {
      personalityId: target.id,
      restoredFromCache,
      hasReviewResult: Boolean(reviewResult),
      reviewing,
      cacheChecked,
      hasReviewableContent,
      autoReviewTriggered: autoReviewTriggeredRef.current,
    });
    autoReviewTriggeredRef.current = target.id;
    void handleReview('INITIAL_REVIEW');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id, hasReviewableContent, reviewing, restoredFromCache, reviewResult, cacheChecked]);

  const handleCopySerialized = useCallback(async () => {
    if (!serialized) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(serialized);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = serialized;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      toast({ title: 'Copied preview', description: 'Serialized prompt copied to clipboard.' });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[wizard dialog] copy serialized failed', e);
      toast({ title: 'Copy failed', description: e?.message || 'Unable to copy preview.', variant: 'destructive' });
    }
  }, [serialized, toast]);

  const updateBeat = (index: number, partial: Partial<WizardBeat>) => {
    setWizardState(curr => {
      const next = [...curr.beats];
      next[index] = { ...next[index], ...partial } as WizardBeat;
      return { ...curr, beats: next };
    });
  };

  const removeBeat = (index: number) => {
    setWizardState(curr => {
      const updated = curr.beats
        .filter((_, idx) => idx !== index)
        .map((b, idx2) => ({ ...b, title: `BEAT ${idx2 + 1}` }));
      return { ...curr, beats: updated };
    });
  };

  const addBeat = () => {
    setWizardState(curr => {
      const nextBeats = [
        ...curr.beats,
        {
          id: `beat-${Date.now()}-${curr.beats.length}`,
          title: `BEAT ${curr.beats.length + 1}`,
          body: '',
          goal: '',
        },
      ];
      return { ...curr, beats: nextBeats };
    });
  };

  const handleSave = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const ok = await onPersist({ primaryPrompt: serialized });
      if (ok) {
        toast({ title: 'Saved wizard output' });
        onClose();
      } else {
        toast({ title: 'Save failed', description: 'Unable to persist personality prompt.', variant: 'destructive' });
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[wizard dialog] save exception', e);
      toast({ title: 'Save failed', description: e?.message || 'Unable to save personality prompt.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (mode: 'INITIAL_REVIEW' | 'REWORK' = 'INITIAL_REVIEW', reworkText?: string) => {
    setReviewing(true);
    if (mode === 'INITIAL_REVIEW') {
      setReviewResult(null);
    }
    const reworkPayload = mode === 'REWORK' ? (reworkText ?? reworkRequest)?.trim() || '' : undefined;
    if (mode === 'REWORK') {
      pendingReworkMergeRef.current = {
        baseline: cloneWizardState(wizardState),
        cachedSuggestion: lastSuggestionsRef.current ? cloneWizardState(lastSuggestionsRef.current) : null,
      };
    } else {
      pendingReworkMergeRef.current = null;
    }
    try {
      // eslint-disable-next-line no-console
      console.info('[wizard dialog] submitting review', {
        promptLength: serialized.length,
        personalityId: target?.id,
        personalityName: target?.name,
        mode,
      });
      const res = await fetch('/api/personalities/wizard/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: reviewPromptPayload,
          promptText: serialized,
          tools: TOOL_APPX,
          mode,
          reworkRequest: reworkPayload,
          personalityId: target?.id,
          personalityName: target?.name,
        }),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error('[wizard dialog] review failed status', res.status);
        const msg = (await res.json().catch(() => ({}))).error || 'Review failed';
        throw new Error(msg);
      }
      const rawText = await res.text();
      let data: any = rawText;
      const tryParse = (val: string) => {
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      };
      data = typeof rawText === 'string' ? tryParse(rawText) : rawText;
      if (typeof data === 'string' && data.trim().startsWith('{')) {
        data = tryParse(data);
      }
      // eslint-disable-next-line no-console
      console.info('[wizard dialog] review success', {
        rawType: typeof data,
        rawTextLength: typeof rawText === 'string' ? rawText.length : undefined,
        rawPreview: typeof rawText === 'string' ? rawText.slice(0, 200) : undefined,
        revisedPromptLength: data?.revisedPrompt?.length,
        revisedType: typeof data?.revisedPrompt,
        revisedKeys: data?.revisedPrompt && typeof data.revisedPrompt === 'object' ? Object.keys(data.revisedPrompt) : null,
      });
      const rawRevised = (data && (data.revisedPrompt ?? data.prompt)) ?? data ?? '';
      const correctedRaw = typeof rawRevised === 'string' && rawRevised.trim() === '[object Object]' && data?.prompt ? data.prompt : rawRevised;
      const normalized = normalizeRevisedPrompt(correctedRaw);
      const explanationRaw = data.explanation;
      const explanation = Array.isArray(explanationRaw)
        ? explanationRaw.join('\n')
        : explanationRaw || 'AI provided a revision.';
      const diffParts = diffLines(serialized, normalized.text).map(part => ({
        type: part.added ? 'add' : part.removed ? 'remove' : 'context',
        value: part.value,
      })) as Array<{ type: 'add' | 'remove' | 'context'; value: string }>;
      const parsedRevision = normalized.state || buildWizardState(normalized.text).state;

      let finalParsed = parsedRevision;
      let finalText = normalized.text;
      const pendingMerge = pendingReworkMergeRef.current;
      if (mode === 'REWORK' && pendingMerge) {
        const merged = mergeReworkWithCachedSuggestions({
          rework: parsedRevision,
          baseline: pendingMerge.baseline,
          cachedSuggestion: pendingMerge.cachedSuggestion,
        });
        finalParsed = merged;
        finalText = serializeWizardState(merged);
      }

      setReviewResult({ revisedPrompt: finalText, explanation, diff: diffParts, parsed: finalParsed });

      // Cache the latest suggestions and the baseline they were derived from
      lastSuggestionsRef.current = cloneWizardState(finalParsed);
      lastSuggestionsBaselineRef.current = cloneWizardState(wizardState);
      toast({ title: 'Review complete', description: 'See AI suggestions in the preview.' });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[wizard dialog] review exception', e);
      toast({ title: 'Review failed', description: e?.message || 'Unable to review', variant: 'destructive' });
    } finally {
      setReviewing(false);
    }
  };

  const applySelectedSections = async () => {
    if (!reviewResult || !suggestedState || saving) return;
    const merged = mergeWizardStateWithSelections(wizardState, suggestedState, sectionSelections);
    const serializedMerged = serializeWizardState(merged);
    setSaving(true);
    try {
      const ok = await onPersist({ primaryPrompt: serializedMerged });
      if (ok) {
        setWizardState(merged);
        toast({ title: 'Applied & saved AI suggestions', description: 'Selected sections merged and persisted.' });
      } else {
        toast({ title: 'Save failed', description: 'Unable to persist merged selections.', variant: 'destructive' });
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[wizard dialog] apply selection save exception', e);
      toast({ title: 'Save failed', description: e?.message || 'Unable to persist merged selections.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const disableActions = !target || saving;

  return (
    <>
      <Dialog open={open} onOpenChange={val => (!val ? onClose() : null)}>
        <DialogContent className="w-[95vw] max-w-[1600px] h-[95vh] max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Personality Wizard {target?.name ? `• ${target.name}` : ''}</DialogTitle>
          <DialogDescription>
            Structure the prompt into sections and preview the serialized output before saving.
          </DialogDescription>
        </DialogHeader>
        {!target ? (
          <div className="text-muted-foreground text-sm">Select a personality to use the wizard.</div>
        ) : (
          <div className="flex flex-1 flex-col min-h-0 relative z-10 bg-background">
            <div className="flex flex-1 flex-col min-h-0 overflow-auto relative z-10">
              <Tabs
                value={activeTab}
                onValueChange={handleTabChange}
                className="relative flex flex-1 flex-col min-h-0 space-y-3 isolate"
              >
                <TabsList className="sticky top-0 z-0 flex flex-wrap gap-2 border-b border-slate-800 bg-transparent px-2 py-2">
                {/* Tabs ordered for optimal LLM prompt structure */}
                <TabsTrigger value="personality">Personality</TabsTrigger>
                <TabsTrigger value="toneVoice">Tone / Voice</TabsTrigger>
                <TabsTrigger value="rules">Rules</TabsTrigger>
                <TabsTrigger value="sequence">Sequence Logic</TabsTrigger>
                <TabsTrigger value="objective">Primary Objective</TabsTrigger>
                <TabsTrigger value="beats">Beats</TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="text-amber-300 data-[state=active]:border-amber-400 data-[state=active]:bg-amber-500/30 data-[state=active]:text-amber-50"
                >
                  Serialized Preview
                </TabsTrigger>
                <TabsTrigger
                  value="review"
                  className="text-emerald-300 data-[state=active]:border-emerald-400 data-[state=active]:bg-emerald-500/30 data-[state=active]:text-emerald-50"
                >
                  <span className="flex items-center gap-1">
                    <span>AI Review</span>
                    {reviewTabDirty ? <span aria-label="New review" className="h-2 w-2 rounded-full bg-amber-300" /> : null}
                  </span>
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="personality"
                className="relative z-20 flex-1 space-y-2 overflow-hidden px-1 min-h-0 data-[state=inactive]:hidden"
              >
                <SectionEditor
                  label="Personality"
                  value={wizardState.personality}
                  onChange={value => setWizardState(curr => ({ ...curr, personality: value }))}
                  hint="Define who the assistant is - identity, role, and primary purpose. This anchors the LLM's behavior."
                />
              </TabsContent>

              <TabsContent
                value="toneVoice"
                className="relative z-20 flex-1 space-y-2 overflow-hidden px-1 min-h-0 data-[state=inactive]:hidden"
              >
                <SectionEditor
                  label="Tone / Voice"
                  value={wizardState.toneVoice}
                  onChange={value => setWizardState(curr => ({ ...curr, toneVoice: value }))}
                  hint="Communication style guidance: confident, witty, formal, casual, etc. Separate from identity for clarity."
                />
              </TabsContent>

              <TabsContent
                value="rules"
                className="relative z-20 flex-1 space-y-2 overflow-hidden px-1 min-h-0 data-[state=inactive]:hidden"
              >
                <SectionEditor
                  label="Rules"
                  value={wizardState.rules}
                  onChange={value => setWizardState(curr => ({ ...curr, rules: value }))}
                  hint="Behavioral constraints and guardrails. Numbered lists work well here."
                />
              </TabsContent>

              <TabsContent
                value="sequence"
                className="relative z-20 flex-1 space-y-2 overflow-hidden px-1 min-h-0 data-[state=inactive]:hidden"
              >
                <SectionEditor
                  label="Sequence Logic"
                  value={wizardState.sequenceLogic}
                  onChange={value => setWizardState(curr => ({ ...curr, sequenceLogic: value }))}
                  hint="Flow control rules: how to handle beat transitions, async events, state checks."
                />
              </TabsContent>

              <TabsContent
                value="objective"
                className="relative z-20 flex-1 space-y-2 overflow-hidden px-1 min-h-0 data-[state=inactive]:hidden"
              >
                <SectionEditor
                  label="Primary Objective"
                  value={wizardState.primaryObjective}
                  onChange={value => setWizardState(curr => ({ ...curr, primaryObjective: value }))}
                  hint="The single overarching goal. Keep it concise and actionable."
                />
              </TabsContent>

              <TabsContent
                value="beats"
                className="relative z-20 flex-1 space-y-3 overflow-hidden px-1 min-h-0 data-[state=inactive]:hidden"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>Beat sections (prompt text)</span>
                    <span className="text-xs text-muted-foreground">{wizardState.beats.length} total</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={addBeat}>
                    Add Beat
                  </Button>
                </div>

                {wizardState.beats.length === 0 ? (
                  <div className="text-muted-foreground text-xs">No beat sections yet. Add one if the prompt needs staged steps.</div>
                ) : (
                  <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
                    {wizardState.beats.map((beat, idx) => {
                      const colorClass = BEAT_BORDER_CLASSES[beatColors[beat.id] ?? 0];
                      return (
                        <div key={beat.id} className={`rounded border-2 ${colorClass} bg-slate-950/60 p-3`}>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                          <div className="flex flex-1 min-w-0 flex-wrap items-center gap-3">
                            <span className="flex-shrink-0">{beat.title}</span>
                            <div className="flex flex-1 min-w-0 items-center gap-2 text-[11px] font-normal text-muted-foreground">
                              <span className="flex-shrink-0">Goal</span>
                              <Input
                                className="h-9 w-full min-w-0 flex-1 text-sm"
                                value={beat.goal || ''}
                                onChange={e => updateBeat(idx, { goal: e.target.value })}
                                placeholder="Goal for this beat"
                              />
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={idx === 0}
                              onClick={() =>
                                setWizardState(curr => ({
                                  ...curr,
                                  beats: reorderBeat(curr.beats, idx, idx - 1),
                                }))
                              }
                              aria-label="Move beat up"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={idx === wizardState.beats.length - 1}
                              onClick={() =>
                                setWizardState(curr => ({
                                  ...curr,
                                  beats: reorderBeat(curr.beats, idx, idx + 1),
                                }))
                              }
                              aria-label="Move beat down"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => removeBeat(idx)} aria-label="Remove beat">
                              ×
                            </Button>
                          </div>
                        </div>
                        <label className="mt-1 block text-[11px] text-muted-foreground">Beat text</label>
                        <Textarea
                          className="mt-1 min-h-[200px]"
                          value={beat.body}
                          onChange={e => updateBeat(idx, { body: e.target.value })}
                          placeholder="What should happen in this beat?"
                        />
                      </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="preview"
                className="relative z-20 flex flex-1 min-h-0 flex-col space-y-2 overflow-hidden px-1 data-[state=inactive]:hidden"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Serialized Preview</span>
                  <span className="text-xs text-muted-foreground">{serialized.length} chars</span>
                </div>
                <pre
                  className="bg-muted flex-1 min-h-0 overflow-y-auto rounded border p-3 text-xs whitespace-pre-wrap break-words cursor-pointer"
                  title="Click to copy serialized prompt"
                  onClick={handleCopySerialized}
                  aria-label="Serialized prompt preview"
                >
                  {serialized}
                </pre>
              </TabsContent>

              <TabsContent
                value="review"
                className="relative z-20 flex h-full flex-col space-y-4 overflow-hidden px-1 text-slate-50 min-h-0 data-[state=inactive]:hidden"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">AI Review</span>
                    {reviewResult ? (
                      <span className="rounded-full bg-emerald-900/60 px-2 py-1 text-[11px] font-semibold text-emerald-50">
                        Changes detected
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setReworkOpen(true)} disabled={reviewing || disableActions}>
                      Request Specific Change
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleReview('INITIAL_REVIEW')} disabled={reviewing || disableActions}>
                      {reviewing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Wand2 className="mr-2 h-3 w-3" />}
                      Review with AI
                    </Button>
                  </div>
                </div>
                {reviewResult ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden text-xs">
                    <div className="rounded-md border border-slate-800 bg-slate-900/90 p-3 text-xl leading-8 text-slate-50">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setIsExplanationOpen(prev => !prev)}
                        aria-expanded={isExplanationOpen}
                      >
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">AI Explanation</div>
                        {isExplanationOpen ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
                      </button>
                      {isExplanationOpen ? (
                        explanationEntries.length ? (
                          <div className="mt-2 max-h-[40vh] overflow-y-auto space-y-2 text-base leading-7 md:text-lg">
                            {explanationEntries.map((entry, idx) => {
                              const key = `${entry.raw}-${idx}`;
                              const hasStructured = entry.before || entry.after || entry.why || entry.section;
                              return (
                                <div key={key} className="rounded border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-sm leading-6">
                                  {entry.section ? (
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Section: {entry.section}</div>
                                  ) : null}
                                  {entry.before ? (
                                    <div className="pl-3 text-[13px] text-slate-100">
                                      <span className="text-rose-300 font-semibold">Before</span>
                                      <span className="mx-2 text-slate-500">|</span>
                                      <span>{entry.before}</span>
                                    </div>
                                  ) : null}
                                  {entry.after ? (
                                    <div className="pl-3 text-[13px] text-slate-100">
                                      <span className="text-emerald-300 font-semibold">After</span>
                                      <span className="mx-2 text-slate-500">|</span>
                                      <span>{entry.after}</span>
                                    </div>
                                  ) : null}
                                  {entry.why ? (
                                    <div className="pl-3 text-[13px] text-slate-100">
                                      <span className="text-amber-300 font-semibold">Why</span>
                                      <span className="mx-2 text-slate-500">|</span>
                                      <span>{entry.why}</span>
                                    </div>
                                  ) : null}
                                  {!hasStructured ? (
                                    <div className="pl-3 text-[13px] text-slate-100">{entry.raw}</div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-2 max-h-[40vh] overflow-y-auto text-sm text-slate-200">{reviewResult.explanation}</div>
                        )
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-300">
                      <span className="rounded bg-rose-900/70 px-2 py-1 font-semibold text-rose-50">Removed (left)</span>
                      <span className="rounded bg-emerald-900/70 px-2 py-1 font-semibold text-emerald-50">Added (right)</span>
                      <span className="rounded bg-slate-800 px-2 py-1 font-semibold text-slate-100">Unchanged</span>
                    </div>
                    {suggestedState ? (
                      buildSectionDiffs(wizardState, suggestedState).length > 0 ? (
                        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                          {buildSectionDiffs(wizardState, suggestedState).map(section => (
                            <SectionDiff
                              key={section.key}
                              label={section.label}
                              current={section.current}
                              suggested={section.suggested}
                              selection={sectionSelections[section.key] ?? false}
                              disabled={reviewing && pendingReworkMergeRef.current !== null}
                              onSelect={value =>
                                setSectionSelections(prev => ({
                                  ...prev,
                                  [section.key]: value,
                                }))
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-[11px]">No changes detected between current and suggested prompt.</div>
                      )
                    ) : (
                      <div className="text-muted-foreground text-[11px]">Unable to parse revision for diff display.</div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full bg-amber-900/80 px-3 py-1 text-[11px] font-semibold text-amber-50 hover:bg-amber-800"
                        onClick={() => setReviewResult(null)}
                        disabled={saving}
                      >
                        Clear Review
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full bg-emerald-900/80 px-3 py-1 text-[11px] font-semibold text-emerald-50 hover:bg-emerald-800"
                        onClick={applySelectedSections}
                        disabled={saving || disableActions}
                      >
                        Apply Selection
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">AI feedback and diff will appear here after running a review.</p>
                )}
              </TabsContent>
            </Tabs>
          </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button variant="secondary" onClick={() => handleReview('INITIAL_REVIEW')} disabled={reviewing || disableActions}>
            {reviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}Review
          </Button>
          <Button onClick={handleSave} disabled={disableActions}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <Dialog open={reworkOpen} onOpenChange={val => { setReworkOpen(val); if (!val) setReworkRequest(''); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Specific Change</DialogTitle>
            <DialogDescription>Describe the exact change you want. The AI will keep everything else the same.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">What would you like to change?</div>
            <Textarea
              value={reworkRequest}
              onChange={e => setReworkRequest(e.target.value)}
              placeholder="Example: In BEAT 2, mention the user should confirm the appointment time."
              className="min-h-[140px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReworkOpen(false); setReworkRequest(''); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setReworkOpen(false);
                void handleReview('REWORK', reworkRequest);
              }}
              disabled={!reworkRequest.trim() || reviewing || disableActions}
            >
              {reviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SectionEditor({ label, value, onChange, hint }: { label: string; value: string; onChange: (val: string) => void; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col space-y-1 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      <Textarea
        className="min-h-[260px] flex-1"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={`Write the ${label.toLowerCase()} here...`}
      />
    </div>
  );
}