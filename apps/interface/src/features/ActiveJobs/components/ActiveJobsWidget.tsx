'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AgentCapsule, AgentCapsuleExpanded } from './AgentCapsule';
import { AgencyLogoMark } from './AgencyAssets';
import { EarlyAccessFeedbackCell } from './EarlyAccessFeedbackCell';
import { NewTaskModal } from './NewTaskModal';
import { useActiveJobs, type ActiveJob, type CompletedJob, type SwarmAgentActivity, type WidgetToast } from '../hooks/useActiveJobs';
import { useLayoutMode } from '@interface/contexts/layout-mode-context';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useUI } from '@interface/contexts/ui-context';
import { useTaskFeedback } from '../hooks/useTaskFeedback';
import { requestWindowClose, requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { PearlAgencyRooms } from '@interface/features/TaskVisualization/PearlAgencyRooms';

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gohufont-active-jobs')) return;
  const style = document.createElement('style');
  style.id = 'gohufont-active-jobs';
  style.textContent = GOHUFONT_FONT_FACE;
  document.head.appendChild(style);
};

// Hides clunky always-on scrollbars on every job-card panel and the outer
// list. Content stays scrollable; the bars just don't render. Reserves a
// stable gutter so showing/hiding overflow never shifts content width.
const ACTIVE_JOBS_SCROLLBAR_CSS = `
.aj-scroll{scrollbar-width:none;-ms-overflow-style:none;scrollbar-gutter:stable;}
.aj-scroll::-webkit-scrollbar{width:0;height:0;background:transparent;}
.aj-scroll::-webkit-scrollbar-thumb{background:transparent;}
`;

const ensureActiveJobsScrollbarCss = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('active-jobs-scrollbar-css')) return;
  const style = document.createElement('style');
  style.id = 'active-jobs-scrollbar-css';
  style.textContent = ACTIVE_JOBS_SCROLLBAR_CSS;
  document.head.appendChild(style);
};

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Friendly display name for an ACP-style agent kind */
function acpKindDisplay(kind: string): string {
  switch (kind) {
    case 'claude-code': return 'Claude Code';
    case 'codex': return 'Codex';
    case 'gemma': return 'Gemma';
    case 'qwen': return 'Qwen';
    default: return kind.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Strip a key like agent:claude-code:<uuid> down to just the id */
function stripAgentKey(raw: string, kind: string): string {
  return raw
    .replace(new RegExp(`^agent:${kind}:`), '')
    .replace(/^acp:[0-9a-f-]{36}:oneshot:[0-9a-f-]{36}$/i, 'Coding session')
    .replace(/^acp:[0-9a-f-]{36}$/i, 'Coding session')
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Coding session');
}

const ACP_KINDS = new Set(['claude-code', 'codex', 'gemma', 'qwen']);

function scrubLegacyFableNames(value: string): string {
  return String(value || '')
    .replace(/\banthropic\/claude[-_\s.]*opus[-_\w.]*/gi, 'Claude Opus 4.6')
    .replace(/\bclaude[-_\s.]*opus[-_\w.]*/gi, 'Claude Opus 4.6')
    .replace(/\bclaude\s+opus\b/gi, 'Claude Opus 4.6')
    .replace(/\bfable\s*5?\b/gi, 'Claude Opus 4.6')
    .replace(/\bopus\b/gi, 'Claude Opus 4.6');
}

/** Friendly agent name from raw identifier */
function friendlyAgentName(agentName: string): string {
  if (!agentName) return 'Agent';
  const lower = agentName.toLowerCase();
  if (lower.includes('codex')) return 'Codex';
  if (lower.includes('opus') || lower.includes('fable')) return 'Claude Opus 4.6';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('claude')) return 'Claude Opus 4.6';
  if (lower.includes('gemma')) return 'Gemma';
  if (lower.includes('qwen')) return 'Qwen';
  if (lower.includes('pearl')) return 'Pearl';
  return agentName.split('/').pop() || agentName;
}

/** Generate a natural 2-sentence description for a polled task */
function generateNaturalDescription(task: PolledTask): string {
  const title = cleanTaskTitle(task.title || 'Task');
  const agent = task.agentName ? friendlyAgentName(task.agentName) : 'The agent';

  if (task.status === 'complete') {
    return `${agent} finished working on ${title.toLowerCase()}. The results are ready for review.`;
  }
  if (task.status === 'running') {
    const timeHint = task.estimatedMinutes ? ` This should take around ${task.estimatedMinutes} minutes.` : '';
    return `${agent} is currently working on ${title.toLowerCase()}.${timeHint}`;
  }
  if (task.status === 'failed') {
    return `${agent} ran into an issue with ${title.toLowerCase()}. It will need to be retried or reviewed.`;
  }
  return `${agent} is queued up to work on ${title.toLowerCase()}. It will start soon.`;
}

/** Agent thought entry */
interface AgentThought {
  agentId: string;
  thought: string;
  timestamp: string;
}

/** Shape returned by /api/tasks */
interface PolledTask {
  taskId: string;
  title: string;
  description?: string;
  agentName?: string;
  estimatedMinutes?: number;
  agentThoughts?: AgentThought[];
  status: 'pending' | 'running' | 'complete' | 'failed';
  screenshotUrl?: string | null;
  approvalStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Returns true if a string looks like a raw hex ID / UUID / hash rather than a human name */
function looksLikeHexId(s: string): boolean {
  // Strip dashes, spaces, dots, and ellipsis — UUIDs can arrive formatted many ways
  const stripped = s.replace(/[-\s.…]+/g, '');
  return /^[0-9a-f]{6,}$/i.test(stripped);
}

/** Shared name lookup for subagent tasks */
const SUBAGENT_NAMES: Record<string, string> = {
  'active-jobs-descriptions': 'Making task names human-friendly',
  'active-jobs-widget': 'Building jobs dashboard',
  'widget-test': 'Testing widget components',
  'pipeline-timing': 'Analyzing voice latency',
  'fix-fast-voice': 'Fixing voice pipeline',
  'fix-duplicate-messages': 'Fixing duplicate messages',
  'fix-simple-silence': 'Fixing voice silence',
  'fix-canvas-leak': 'Fixing canvas memory leak',
  'canvas-zindex': 'Fixing avatar visibility',
  'context-audit': 'Optimizing response speed',
  'swarm-architecture': 'Designing multi-agent system',
  'regression-analysis': 'Running regression analysis',
  'investigate-duplicates': 'Investigating duplicate events',
  'mobile-widget-fix': 'Fixing mobile layout',
  'tasklist-ui': 'Redesigning task list',
  'pearlos-bridge-rewrite': 'Rewriting PearlOS event bridge',
  'desktop-icon-overhaul': 'Redesigning desktop icons',
  'home-desktop-toggle': 'Building home/desktop toggle',
  'desktop-nav-buttons': 'Adding desktop navigation buttons',
  'bg-gen': 'Generating pixel art backgrounds',
  'fix-home-bg': 'Setting home screen background',
  'wonder-canvas-fix': 'Fixing Wonder Canvas rendering',
  'voice-pipeline-healthcheck': 'Checking voice pipeline health',
  'pre-release-health-monitor': 'Running service health checks',
};

/** Shared name lookup for cron tasks */
const CRON_NAMES: Record<string, string> = {
  'voice-pipeline-healthcheck': 'Voice system health check',
  'pre-release-health-monitor': 'Release readiness check',
  'voice-pipeline-health': 'Voice system health check',
  'desktop-icon-overhaul': 'Desktop icon redesign',
  'desktop-icon-overhaul-swarm-v2': 'Desktop icon redesign',
};

/** Clean up a slug into a title-cased label, stripping version suffixes */
function slugToTitle(slug: string): string {
  return slug
    .replace(/-v\d+$/i, '')
    .replace(/-swarm(-v\d+)?$/i, '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Strip transport/source boilerplate so cards lead with the actual work. */
function cleanTaskTitle(raw: string): string {
  const cleaned = (raw || 'Task')
    .replace(/(?:🏆|🏅|🎖️)+/gu, '')
    .replace(/^\s*(?:discord|webchat|web chat|agency chat|telegram|slack)\s+request(?:\s+from\s+[^:\u2013\u2014-]+)?\s*[:\u2013\u2014-]\s*/i, '')
    .replace(/^\s*(?:discord|webchat|web chat|agency chat|telegram|slack)\s+request(?:\s+from\s+\S+)?\s+/i, '')
    .replace(/^\s*request\s+from\s+[^:\u2013\u2014-]+\s*[:\u2013\u2014-]\s*/i, '')
    .replace(/^\s*(?:task|job)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Task';
}

function displayTaskTitle(raw: string): string {
  return scrubLegacyFableNames(cleanTaskTitle(raw));
}

function usefulJobTitle(job: ActiveJob | CompletedJob): string | null {
  for (const candidate of [job.fullTitle, job.description]) {
    const cleaned = cleanTaskTitle(candidate || '');
    if (cleaned && cleaned !== 'Task' && !looksLikeHexId(cleaned)) return cleaned;
  }
  return null;
}

/** Turn internal job labels into plain English */
function humanizeLabel(job: ActiveJob | CompletedJob): string {
  const raw = job.label || job.displayName || job.key || 'Task';

  if (ACP_KINDS.has(job.kind)) {
    const cleaned = stripAgentKey(raw, job.kind);
    if (cleaned === 'Coding session') return `${acpKindDisplay(job.kind)} session`;
    if (looksLikeHexId(cleaned)) return `${acpKindDisplay(job.kind)} session`;
    return cleanTaskTitle(cleaned.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  }

  // Raw queue/session IDs are useful internally, but useless on the card. If
  // the job carries a real title or description, surface that before falling
  // back to the generic bucket.
  if (looksLikeHexId(raw)) return usefulJobTitle(job) || 'Background task';

  if (raw.startsWith('Cron: ') || job.kind === 'cron') {
    const slug = raw.replace(/^Cron:\s*/, '');
    for (const [key, label] of Object.entries(CRON_NAMES)) {
      if (slug.includes(key)) return label;
    }
    return slugToTitle(slug);
  }

  if (job.kind === 'subagent') {
    const cleaned = raw.replace(/^agent:main:subagent:/, '');

    for (const [key, label] of Object.entries(SUBAGENT_NAMES)) {
      if (cleaned.includes(key)) return label;
    }

    if (looksLikeHexId(cleaned)) return usefulJobTitle(job) || 'Background task';

    return slugToTitle(cleaned);
  }

  return cleanTaskTitle(raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
}

// ── Swarm category derivation ──────────────────────────────────────────────
// The front of the task card shows a swarm category ("Legal", "Creative",
// "Code", …) instead of raw agent identities. Single-agent / CLI tasks collapse
// to "The Agency". Keywords are matched against title + description + assignee
// so metadata-light tasks still get a sensible label. Backend can override
// via `swarmCategory` (or aliases) on the task record.
const SWARM_CATEGORY_KEYWORDS: Array<{ match: RegExp; label: string }> = [
  { match: /\b(legal|contract|compliance|gdpr|lawsuit|nda|policy)\b/i, label: 'Legal' },
  { match: /\b(medical|clinical|diagnos|patient|pharma)\b/i, label: 'Medical' },
  { match: /\b(architect|plan|roadmap|strategy|spec)\b/i, label: 'Architect' },
  { match: /\b(creative|art|design|brand|illustrat|pixel|sprite|logo)\b/i, label: 'Creative' },
  { match: /\b(research|investigat|analy[sz]|audit|explore|survey)\b/i, label: 'Research' },
  { match: /\b(qa|review|\btest\b|regress|verif)\b/i, label: 'QA' },
  { match: /\b(voice|audio|pipeline|transcri)\b/i, label: 'Voice' },
  { match: /\b(code|fix|bug|refactor|api|widget|component|migration|build|feature)\b/i, label: 'Code' },
];

function resolveSwarmCategory(job: ActiveJob): string {
  if (job.swarmCategory && job.swarmCategory.trim()) return job.swarmCategory.trim();
  const text = `${job.label || ''} ${job.description || ''} ${job.assignee || ''}`;
  for (const { match, label } of SWARM_CATEGORY_KEYWORDS) {
    if (match.test(text)) return label;
  }
  return 'The Agency';
}

/** Front-of-card label: "The Agency" for CLI tasks, "<Category> Swarm" for multi-agent. */
function swarmDisplay(job: ActiveJob): string {
  const cat = resolveSwarmCategory(job);
  const multiAgent = (job.agents?.length ?? 0) > 1;
  if (multiAgent && cat !== 'The Agency') return `${cat} Swarm`;
  return cat;
}

// ── Category → action verb ────────────────────────────────────────────────
// The card front used to show "The Agency · pending", which read as chrome.
// Replace it with what the agent is *doing*: "Working...", "Writing code...",
// etc. The verb is keyed off the swarm category (which itself can be inferred
// from the task text), so a single CLI task and a multi-agent swarm share the
// same vocabulary.
const CATEGORY_ACTIVE_VERB: Record<string, string> = {
  Code: 'Writing code...',
  Creative: 'Designing...',
  Research: 'Researching...',
  Legal: 'Researching...',
  Medical: 'Researching...',
  QA: 'Reviewing...',
  Architect: 'Planning...',
  Voice: 'Working...',
  'The Agency': 'Working...',
};

const CATEGORY_PENDING_VERB: Record<string, string> = {
  Code: 'Queued to code...',
  Creative: 'Queued to design...',
  Research: 'Queued to research...',
  Legal: 'Queued to research...',
  Medical: 'Queued to research...',
  QA: 'Queued to review...',
  Architect: 'Queued to plan...',
  Voice: 'Queued...',
  'The Agency': 'Queued...',
};

/**
 * Action-verb subtitle for a task — what the agent is doing right now.
 * Status-aware: shows the active verb while running, a queued variant while
 * pending, and a terminal label otherwise. Falls back to the generic Agency
 * verbs whenever the category isn't one we have a specific verb for.
 */
function agentActionText(job: ActiveJob): string {
  const status = job.rawStatus || job.status;
  if (status === 'completed' || status === 'complete') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';

  const cat = resolveSwarmCategory(job);
  const isPending = status === 'pending';
  const table = isPending ? CATEGORY_PENDING_VERB : CATEGORY_ACTIVE_VERB;
  const fallback = isPending ? CATEGORY_PENDING_VERB['The Agency'] : CATEGORY_ACTIVE_VERB['The Agency'];
  return table[cat] || fallback;
}

/** Subtitle line: short human-readable context for what kind of task this is */
function humanizeSubtitle(job: ActiveJob): string {
  // Task-queue items surface a verb describing what the agent is doing —
  // never raw agent names. Swarms also show their category on the collapsed
  // card so staging smokes can verify task display metadata without opening
  // the technical panel.
  if (job.kind === 'task') {
    const action = agentActionText(job);
    const urgency = job.urgency === 'urgent' ? ' · urgent' : '';
    return `${action}${urgency}`;
  }
  if (isSwarmJob(job)) {
    const action = agentActionText(job);
    const urgency = job.urgency === 'urgent' ? ' · urgent' : '';
    return `${swarmDisplay(job)} · ${action}${urgency}`;
  }

  const kindLabel = job.kind === 'cron'
    ? 'Scheduled check'
    : job.kind === 'subagent'
    ? 'Background task'
    : ACP_KINDS.has(job.kind)
    ? `${acpKindDisplay(job.kind)} · coding agent`
    : 'Background task';

  if (job.status === 'failed') return `${kindLabel} · something went wrong`;
  if (job.status === 'complete') return `${kindLabel} · done`;
  if (job.status === 'running') {
    const desc = job.description || '';
    const label = humanizeLabel(job);
    if (desc && desc.toLowerCase() !== label.toLowerCase()) {
      const short = desc.length > 50 ? desc.slice(0, 47) + '…' : desc;
      return short;
    }
    return kindLabel;
  }
  return kindLabel;
}

function StatusIndicator({ status }: { status: ActiveJob['status'] }) {
  if (status === 'running') {
    return (
      <div className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
        <div
          className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"
          style={{ animationDuration: '1.5s' }}
        />
        <div className="absolute w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
      </div>
    );
  }
  if (status === 'complete') {
    return (
      <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
        <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
      <div className="w-2.5 h-2.5 bg-yellow-400/60 rounded-full" />
    </div>
  );
}

function ExpandChevron({ expanded }: { expanded: boolean }) {
  return (
    <div className="flex items-center justify-center min-w-[32px] min-h-[32px] flex-shrink-0">
      <svg
        className={`w-4 h-4 text-white/40 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

/** Format model name to be friendly */
function friendlyModel(model: string): string {
  if (!model) return '';
  const name = model.split('/').pop() || model;
  const modelNames: Record<string, string> = {
    'claude-opus-4.6': 'Claude Opus 4.6 (deep thinking)',
    'claude-opus-4-6': 'Claude Opus 4.6 (deep thinking)',
    'claude-sonnet-4-5': 'Sonnet (fast)',
    'claude-sonnet-4.5': 'Sonnet (fast)',
    'claude-sonnet-4-5-20250514': 'Sonnet (fast)',
    'gpt-4o-mini': 'GPT-4o Mini (speed)',
  };
  if (modelNames[name]) return modelNames[name];
  if (/opus|fable/i.test(name)) return 'Claude Opus 4.6';
  if (/sonnet/i.test(name)) return 'Sonnet';
  if (/claude/i.test(name)) return 'Claude Opus 4.6';
  return scrubLegacyFableNames(name);
}

/** Humanize completed job label — delegates to the shared humanizeLabel */
function humanizeCompletedLabel(job: CompletedJob): string {
  return humanizeLabel(job);
}

/** Format relative time for completed jobs */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Generate a human-friendly summary from a job */
function generateHumanSummary(job: ActiveJob | CompletedJob): string {
  const label = scrubLegacyFableNames('elapsedMs' in job ? humanizeLabel(job as ActiveJob) : humanizeCompletedLabel(job as CompletedJob));
  const desc = scrubLegacyFableNames(job.description || '');

  if (desc && desc.toLowerCase() !== label.toLowerCase()) {
    if (desc.includes('. ') || desc.includes('? ') || desc.includes('! ')) {
      return desc;
    }
    const agentsList = 'agents' in job && (job as ActiveJob).agents?.length > 0
      ? (job as ActiveJob).agents.map(friendlyModel).join(', ')
      : job.model ? friendlyModel(job.model) : '';
    const agentInfo = agentsList ? ` Using ${agentsList}.` : '';
    const statusInfo = 'status' in job
      ? job.status === 'complete' ? ' Task completed successfully.' : ' Currently in progress.'
      : '';
    return `${desc}.${agentInfo || statusInfo}`;
  }

  const lbl = label.toLowerCase();
  const agentsStr = 'agents' in job && (job as ActiveJob).agents?.length > 0
    ? (job as ActiveJob).agents.map(friendlyModel).join(', ')
    : job.model ? friendlyModel(job.model) : '';
  const modelInfo = agentsStr ? ` Using ${agentsStr}.` : '';
  const isComplete = 'status' in job && job.status === 'complete';

  if (lbl.includes('health check') || lbl.includes('healthcheck')) {
    const what = lbl.includes('voice') ? 'voice system' : lbl.includes('release') ? 'release readiness' : 'system';
    return `Running a quick check to make sure the ${what} is working properly. This helps catch issues before they affect users.${modelInfo}`;
  }
  if (lbl.includes('voice') && lbl.includes('fix')) {
    return `Working on fixing an issue with the voice system. This should improve audio quality and response time.${modelInfo}`;
  }
  if (lbl.includes('redesign') || lbl.includes('overhaul')) {
    const target = lbl.replace(/redesign(ing)?|overhaul(ing)?/gi, '').trim();
    return `Redesigning ${target || 'the interface'} to look better and work more smoothly.${modelInfo}`;
  }
  if (lbl.includes('fix')) {
    const target = lbl.replace(/fix(ing)?/gi, '').trim() || 'a component';
    return `Fixing an issue with ${target}. This should resolve bugs and improve stability.${modelInfo}`;
  }
  if (lbl.includes('build') || lbl.includes('creating')) {
    const target = lbl.replace(/build(ing)?|creating?/gi, '').trim() || 'a new feature';
    return `Building ${target} from scratch. This adds new functionality to PearlOS.${modelInfo}`;
  }
  if (lbl.includes('analyz') || lbl.includes('analysis')) {
    const target = lbl.replace(/analyz(ing|e)?|analysis/gi, '').trim() || 'the system';
    return `Analyzing ${target} to understand what's happening.${modelInfo}`;
  }
  if (lbl.includes('test')) {
    const target = lbl.replace(/test(ing)?/gi, '').trim() || 'components';
    return `Testing ${target} to make sure everything works correctly.${modelInfo}`;
  }

  const action = isComplete ? 'Completed' : 'Working on';
  const duration = 'elapsedMs' in job ? ` Took ${formatElapsed(job.elapsedMs)}.` : '';
  const tokens = job.totalTokens > 0 ? ` Used ${job.totalTokens.toLocaleString()} tokens.` : '';
  return `${action} task: ${label}. ${isComplete ? (duration || tokens || 'Finished successfully.') : (modelInfo || 'In progress.')}`;
}

function EyeToggleIcon({ active, onClick }: { active: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center justify-center w-6 h-6 rounded-md
        transition-all duration-150 select-none cursor-pointer
        ${active ? 'text-white/60 bg-white/5' : 'text-white/25 hover:text-white/40'}
      `}
      title={active ? 'Show summary' : 'Show technical details'}
      aria-label={active ? 'Show summary' : 'Show technical details'}
    >
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>
  );
}

function ThumbUpIcon({ filled, className }: { filled?: boolean; className?: string }) {
  return filled ? (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
    </svg>
  );
}

function ThumbDownIcon({ filled, className }: { filled?: boolean; className?: string }) {
  return filled ? (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" style={{ transform: 'scaleY(-1)' }}>
      <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.4} style={{ transform: 'scaleY(-1)' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
    </svg>
  );
}

function ApprovalNeededBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`
        inline-flex items-center justify-center px-1.5 h-6 rounded-md
        text-[9px] font-medium text-amber-300/90 bg-amber-400/10 border border-amber-400/20 ${className}
      `}
      title="Waiting on your approval"
      aria-label="Needs approval"
    >
      Review
    </span>
  );
}

function FeedbackButtons({
  jobId,
  jobLabel,
  feedbackGiven,
  onThumbsUp,
  onThumbsDown,
}: {
  jobId: string;
  jobLabel: string;
  feedbackGiven?: 'up' | 'down';
  onThumbsUp: (id: string, label: string) => void;
  onThumbsDown: (id: string, label: string) => void;
}) {
  if (feedbackGiven) {
    return (
      <div className="flex items-center flex-shrink-0 ml-1.5">
        <div
          className={`
            flex items-center justify-center w-7 h-7 rounded-lg
            ${feedbackGiven === 'up'
              ? 'text-green-400/80 bg-green-400/10'
              : 'text-red-400/80 bg-red-400/10'
            }
          `}
          title={feedbackGiven === 'up' ? 'Marked correct' : 'Feedback submitted'}
        >
          {feedbackGiven === 'up'
            ? <ThumbUpIcon filled className="w-3.5 h-3.5" />
            : <ThumbDownIcon filled className="w-3.5 h-3.5" />
          }
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 flex-shrink-0 ml-1.5" onClick={(e) => e.stopPropagation()}>
      <ApprovalNeededBadge />
      <button
        onClick={() => onThumbsUp(jobId, jobLabel)}
        className="
          group w-7 h-7 flex items-center justify-center rounded-lg
          text-white/30 hover:text-green-400
          hover:bg-green-400/10 hover:shadow-[0_0_8px_rgba(74,222,128,0.15)]
          active:scale-90 active:bg-green-400/20
          transition-all duration-200 ease-out
        "
        title="Task completed correctly"
        aria-label="Thumbs up"
      >
        <ThumbUpIcon className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110" />
      </button>
      <button
        onClick={() => onThumbsDown(jobId, jobLabel)}
        className="
          group w-7 h-7 flex items-center justify-center rounded-lg
          text-white/30 hover:text-red-400
          hover:bg-red-400/10 hover:shadow-[0_0_8px_rgba(248,113,113,0.15)]
          active:scale-90 active:bg-red-400/20
          transition-all duration-200 ease-out
        "
        title="Task has issues — give feedback"
        aria-label="Thumbs down"
      >
        <ThumbDownIcon className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110" />
      </button>
    </div>
  );
}

/** Inline feedback form that expands below a job card */
function InlineFeedbackForm({
  taskId,
  taskName,
  taskDescription,
  onSubmit,
  onCancel,
  submitting,
}: {
  taskId: string;
  taskName: string;
  taskDescription?: string;
  onSubmit: (feedback: { taskId: string; taskName: string; type: 'down'; notes: string; images: File[]; timestamp: number; mode: 'text'; taskDescription?: string }) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [notes, setNotes] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-focus the textarea when it appears
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = () => {
    if (!notes.trim()) return;
    onSubmit({
      taskId,
      taskName,
      type: 'down',
      notes,
      images: [],
      timestamp: Date.now(),
      mode: 'text',
      taskDescription,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div
      className="mt-1 bg-[#0d0815]/80 backdrop-blur-md border border-red-400/20 rounded-xl p-3 space-y-2 animate-in slide-in-from-top-2 duration-200"
      style={{ fontFamily: 'Gohufont, monospace', minWidth: '280px', maxWidth: 'min(360px, calc(100vw - 40px))' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] text-red-300/60 uppercase tracking-wider">
        What went wrong?
      </div>
      <textarea
        ref={inputRef}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe the issue… (Enter to submit)"
        className="
          w-full h-16 px-2.5 py-2 rounded-lg
          bg-[#0a0610]/80 border border-white/10
          text-xs text-white/80 placeholder-white/25
          resize-none outline-none
          focus:border-red-400/30 focus:ring-1 focus:ring-red-400/10
          transition-colors duration-150
        "
        style={{ fontFamily: 'Gohufont, monospace' }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-white/25">
          Task will be relaunched with your feedback
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded-lg text-[10px] text-white/40 hover:text-white/60 border border-white/10 hover:border-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !notes.trim()}
            className="
              px-2.5 py-1 rounded-lg text-[10px] font-medium
              bg-red-500/20 text-red-300 border border-red-400/30
              hover:bg-red-500/30 hover:border-red-400/50
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {submitting ? 'Sending…' : 'Redo Task'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Task-queue controls: Play (start / emergency), Cancel, Ask Agent
// ────────────────────────────────────────────────────────────────────────────

function PriorityBadge() {
  return (
    <span
      className="
        inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold
        bg-green-500/20 text-green-300 border border-green-400/40 flex-shrink-0
        uppercase tracking-wider animate-pulse
      "
      title="Priority override — user-promoted to front of queue"
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.518 11.59c.75 1.335-.213 2.99-1.743 2.99H3.482c-1.53 0-2.492-1.655-1.743-2.99L8.257 3.099ZM11 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1-8a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Z" />
      </svg>
      Priority
    </span>
  );
}

function ActiveBadge() {
  return (
    <span
      className="
        inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium
        bg-green-500/10 text-green-300/90 border border-green-400/30 flex-shrink-0
        uppercase tracking-wider
      "
      title="Started by user"
    >
      Active
    </span>
  );
}

function CancelButton({ onCancel }: { onCancel: () => void | Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    try { await onCancel(); } finally { setPending(false); }
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="group flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 text-white/40 hover:text-rose-400 hover:bg-rose-400/10 transition-all duration-200 disabled:opacity-40"
      title={confirming ? 'Click again to confirm cancel' : 'Cancel task'}
      aria-label="Cancel task"
    >
      {pending ? (
        <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      ) : (
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" /></svg>
      )}
    </button>
  );
}

function AskAgentControl({
  taskId,
  taskTitle,
  taskDescription,
  onAsk,
}: {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  onAsk?: (question: string) => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const submit = async () => {
    const q = value.trim();
    if (!q || pending) return;
    setPending(true);
    try {
      // Open the web chat with the task as context + the user's question.
      // ChatMode listens for this event and posts the message + tracks
      // a "pending reply" placeholder for when the widget closes.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pearl:ask-from-task', {
          detail: { taskId, taskTitle, taskDescription, question: q },
        }));
      }
      // Still notify the running agent via task notes so the task owner
      // sees the question without us replacing the existing notes channel.
      if (onAsk) {
        await onAsk(q);
      }
      setSent(true);
      setValue('');
      setTimeout(() => {
        setSent(false);
        setOpen(false);
      }, 1200);
    } finally {
      setPending(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="
          flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
          bg-blue-500/10 text-blue-300/90 border border-blue-400/25
          hover:bg-blue-500/20 hover:border-blue-400/40
          transition-colors duration-150
        "
        title="Ask Pearl about this task — she'll reply in the text chat"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
        (?) Ask Pearl
      </button>
    );
  }

  return (
    <div className="w-full flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="text-[10px] text-blue-300/70 uppercase tracking-wider">
        Ask Pearl — answers in chat
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          }}
          disabled={pending || sent}
          placeholder="e.g. will this impact our token use"
          className="
            flex-1 px-2 py-1 rounded-md
            bg-[#0a0610]/80 border border-white/10
            text-[11px] text-white/80 placeholder-white/25
            outline-none
            focus:border-blue-400/40 focus:ring-1 focus:ring-blue-400/20
          "
          style={{ fontFamily: 'Gohufont, monospace' }}
        />
        <button
          onClick={() => void submit()}
          disabled={pending || !value.trim() || sent}
          className="
            px-2 py-1 rounded-md text-[10px] font-medium
            bg-blue-500/20 text-blue-300 border border-blue-400/40
            hover:bg-blue-500/30 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          {sent ? 'Sent ✓' : pending ? '…' : 'Send'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="
            px-2 py-1 rounded-md text-[10px] font-medium
            text-white/50 border border-white/10 hover:border-white/20
            transition-colors
          "
        >
          Close
        </button>
      </div>
      <div className="text-[9px] text-white/30">
        Appended to the task as a note — the agent will read it without being interrupted.
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SwarmControls — real-time execution controls that replace the old
// play/emergency label-only buttons. Each button hits a backend action that
// actually changes task state. Start hands the task back to the SSE worker,
// pause/stop parks it away from the executable assignee and sends a stop
// signal, and priority tweaks the queue.
// ────────────────────────────────────────────────────────────────────────────
function SwarmControlButton({
  label,
  tone,
  title,
  onClick,
  children,
  compact,
}: {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  title: string;
  onClick: () => void | Promise<unknown>;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const toneStyles: Record<typeof tone, string> = {
    green: 'bg-green-500/10 text-green-300 border-green-400/30 hover:bg-green-500/20 hover:border-green-400/50',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-400/30 hover:bg-amber-500/20 hover:border-amber-400/50',
    red:   'bg-red-500/10   text-red-300   border-red-400/30   hover:bg-red-500/20   hover:border-red-400/50',
    blue:  'bg-blue-500/10  text-blue-300  border-blue-400/30  hover:bg-blue-500/20  hover:border-blue-400/50',
    slate: 'bg-white/5       text-white/60  border-white/15      hover:bg-white/10      hover:border-white/25',
  };
  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      await onClick();
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      onClick={handle}
      disabled={pending}
      title={title}
      aria-label={label}
      className={`
        inline-flex items-center gap-1 rounded-md border text-[10px] font-medium
        transition-colors duration-150 select-none
        disabled:opacity-40 disabled:cursor-not-allowed
        ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'}
        ${toneStyles[tone]}
      `}
    >
      {pending
        ? <div className="w-2.5 h-2.5 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
        : children}
      {!compact && <span>{label}</span>}
    </button>
  );
}

function SwarmControls({
  job,
  onStart,
  onPause,
  onStop,
  onPrioritize,
  onDeprioritize,
  compact,
}: {
  job: ActiveJob;
  onStart?: (id: string) => Promise<boolean>;
  onPause?: (id: string) => Promise<boolean>;
  onStop?: (id: string) => Promise<boolean>;
  onPrioritize?: (id: string) => Promise<boolean>;
  onDeprioritize?: (id: string) => Promise<boolean>;
  compact?: boolean;
}) {
  const isRunning = job.status === 'running';
  const isPending = job.status === 'idle' || job.rawStatus === 'pending';
  const isFailed = job.status === 'failed';
  const isTerminal = job.status === 'complete';
  if (isTerminal) return null;

  const isUrgent = job.urgency === 'urgent';

  return (
    <div
      className={`flex items-center flex-wrap ${compact ? 'gap-1' : 'gap-1.5'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {(isPending || isFailed) && onStart && (
        <SwarmControlButton
          label="Start"
          tone="green"
          title="Begin execution — spawns the worker"
          onClick={() => onStart(job.id)}
          compact={compact}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.5 4.5v11a.5.5 0 0 0 .77.42l9-5.5a.5.5 0 0 0 0-.84l-9-5.5A.5.5 0 0 0 6.5 4.5Z" />
          </svg>
        </SwarmControlButton>
      )}
      {isRunning && onPause && (
        <SwarmControlButton
          label="Pause"
          tone="amber"
          title="Pause execution and re-queue"
          onClick={() => onPause(job.id)}
          compact={compact}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="5"  y="4" width="3" height="12" rx="0.75" />
            <rect x="12" y="4" width="3" height="12" rx="0.75" />
          </svg>
        </SwarmControlButton>
      )}
      {isRunning && onStop && (
        <SwarmControlButton
          label="Stop"
          tone="red"
          title="Stop execution and reset to pending"
          onClick={() => onStop(job.id)}
          compact={compact}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="4" y="4" width="12" height="12" rx="1.5" />
          </svg>
        </SwarmControlButton>
      )}
      {(isPending || isRunning) && onPrioritize && !isUrgent && (
        <SwarmControlButton
          label="Priority"
          tone="blue"
          title="Bump this task up in the queue"
          onClick={() => onPrioritize(job.id)}
          compact={compact}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 4l6 7H4l6-7z" />
          </svg>
        </SwarmControlButton>
      )}
      {(isPending || isRunning) && onDeprioritize && isUrgent && (
        <SwarmControlButton
          label="Deprioritize"
          tone="slate"
          title="Lower this task in the queue"
          onClick={() => onDeprioritize(job.id)}
          compact={compact}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 16l-6-7h12l-6 7z" />
          </svg>
        </SwarmControlButton>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AgentEmojiBubbles — agent emoji + a white speech bubble carrying that
// agent's most recent thought/work snippet. Replaces the older colored name
// pills. CLI / single-agent tasks fall back to the latest task note (or just
// the emoji if nothing has been said yet).
// ────────────────────────────────────────────────────────────────────────────

/** Latest human-readable note text for a task, capped to a chat-bubble length. */
function latestNoteText(job: ActiveJob): string {
  if (!job.notes?.length) return '';
  const last = job.notes[job.notes.length - 1];
  const text = scrubLegacyFableNames(last?.text || '').trim();
  if (!text) return '';
  return text.length > 90 ? text.slice(0, 87) + '…' : text;
}

// ────────────────────────────────────────────────────────────────────────────
// Swarm bridge: OpenRouter swarm rendering
// ────────────────────────────────────────────────────────────────────────────
// `kind: 'swarm'` tasks come from pearl-swarm-dispatch's lifecycle POSTs. Each
// agent gets a single emoji that pulses while working and settles to a
// checkmark once done. When the dispatcher ships a partial "thought" for an
// agent we render it as a 5-second thinking bubble so the user can see what
// each agent is chewing on.

/** Emoji per agent family — matches the product spec. Specific Claude
    variants (opus/sonnet) come before the generic `claude` matcher so the
    medium-code-pattern lineup of Claude Opus/Kimi/Gemini/Codex renders four distinct
    agent markers. */
const AGENT_EMOJI_MAP: Array<{ match: RegExp; emoji: string }> = [
  { match: /\b(opus|fable)\b/i, emoji: '🦁' },
  { match: /\b(sonnet)\b/i, emoji: '🐙' },            // Sonnet — octopus
  { match: /\bclaude[- ]?code\b/i, emoji: '🐙' },     // Claude Code variant
  { match: /\b(kimi|moonshot)\b/i, emoji: '🐯' },     // Kimi — tiger
  { match: /\b(gemini|google)\b/i, emoji: '🦊' },     // Gemini — fox
  { match: /\b(codex)\b/i, emoji: '🐬' },             // Codex — dolphin
  { match: /\b(gpt|openai|o[1-4])\b/i, emoji: '🦎' }, // OpenAI/GPT — chameleon
  { match: /\b(qwen|qwq)\b/i, emoji: '🦉' },          // Qwen — owl
  { match: /\b(gemma)\b/i, emoji: '🐱' },             // Gemma — cat
  { match: /\b(claude)[- ]?/i, emoji: '🐙' },         // Claude family fallback
  { match: /\b(pearl)\b/i, emoji: '🦢' },             // Pearl — swan
];

function emojiForAgent(agentName: string): string {
  const name = agentName || '';
  for (const { match, emoji } of AGENT_EMOJI_MAP) {
    if (match.test(name)) return emoji;
  }
  return '🐙';
}

function compactAgentKey(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function agentActivityFor(job: ActiveJob, agentId: string): SwarmAgentActivity | undefined {
  const activity = job.agentActivity || {};
  if (activity[agentId]) return activity[agentId];

  const compactAgent = compactAgentKey(agentId);
  const compactFriendlyAgent = compactAgentKey(friendlyAgentName(agentId));
  return Object.entries(activity).find(([key]) => {
    const compactKey = compactAgentKey(key);
    const compactFriendlyKey = compactAgentKey(friendlyAgentName(key));
    return (
      (compactAgent && compactKey && (compactKey === compactAgent || compactKey.includes(compactAgent) || compactAgent.includes(compactKey))) ||
      (compactFriendlyAgent && (compactFriendlyKey === compactFriendlyAgent || compactKey === compactFriendlyAgent)) ||
      (compactFriendlyKey && compactFriendlyKey === compactAgent)
    );
  })?.[1];
}

/** True if the dispatcher timestamped an agent thought within the fade window. */
function isThoughtFresh(activity: SwarmAgentActivity | undefined, windowMs = 5000): boolean {
  if (!activity?.thought || !activity?.updatedAt) return false;
  const ts = Date.parse(activity.updatedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= windowMs;
}

/**
 * Horizontal row of agent emojis with live status + a transient thinking
 * bubble. Drives the "at a glance" view the user sees on a swarm card.
 *
 * The compact variant renders the emojis at ~50% the normal size and skips
 * the thinking-bubble row so the emojis can sit inline with the card's
 * action buttons. The normal variant keeps the bubbles for the expanded
 * back-of-card view.
 */
function SwarmAgentEmojiRow({ job, compact }: { job: ActiveJob; compact?: boolean }) {
  // Force a re-render every 1s while any agent is working so the thinking
  // bubbles can fade out once their 5s window elapses. Cheap — the row only
  // exists on swarm cards which are typically <=5 on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (job.status !== 'running') return;
    const activity = job.agentActivity || {};
    const hasFresh = Object.values(activity).some((a) => isThoughtFresh(a));
    if (!hasFresh) return;
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [job.status, job.agentActivity]);

  const agents = job.agents && job.agents.length > 0 ? job.agents : [];
  if (agents.length === 0) return null;

  const cellSize = compact ? 12 : 22;
  const fontClass = compact ? 'text-[11px]' : 'text-[16px]';
  const tickClass = compact ? 'text-[6px]' : 'text-[8px]';

  return (
    <div className={`flex flex-col ${compact ? 'gap-0.5' : 'mt-1.5 gap-1'}`}>
      <div
        className={`flex items-center ${compact ? 'gap-0.5' : 'gap-1'} overflow-x-auto scrollbar-none`}
        style={{ scrollbarWidth: 'none' }}
      >
        {agents.map((agentId) => {
          const activity = agentActivityFor(job, agentId);
          const agentStatus = activity?.status || (job.status === 'running' ? 'running' : 'done');
          const running = agentStatus === 'running';
          const done = agentStatus === 'done';
          const failed = agentStatus === 'failed';
          return (
            <div
              key={agentId}
              className={`
                relative flex items-center justify-center
                ${fontClass} leading-none select-none
                transition-opacity duration-300
                ${running ? 'opacity-100' : done ? 'opacity-90' : failed ? 'opacity-50' : 'opacity-70'}
              `}
              style={{ width: cellSize, height: cellSize }}
              title={`${friendlyAgentName(agentId)} · ${agentStatus}${activity?.thought ? ` — ${activity.thought}` : ''}`}
            >
              <span className={running ? 'animate-pulse' : ''}>{emojiForAgent(agentId)}</span>
              {done && (
                <span className={`absolute -bottom-0.5 -right-0.5 ${tickClass} text-green-400 leading-none`}>✓</span>
              )}
              {failed && (
                <span className={`absolute -bottom-0.5 -right-0.5 ${tickClass} text-red-400 leading-none`}>✗</span>
              )}
            </div>
          );
        })}
      </div>
      {/* Thinking bubbles — only show agents with a fresh partial thought.
          Skipped in compact mode to keep the emoji row inline with the
          action buttons; the expanded panel still renders bubbles. */}
      {!compact && (() => {
        const bubbles = agents
          .map((agentId) => ({ agentId, activity: agentActivityFor(job, agentId) }))
          .filter((x) => isThoughtFresh(x.activity));
        if (bubbles.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-1 text-[10px] text-white/60 leading-snug">
            {bubbles.map(({ agentId, activity }) => (
              <span
                key={agentId}
                className="
                  inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                  bg-white/5 border border-white/10 max-w-[200px]
                "
              >
                <span>{emojiForAgent(agentId)}</span>
                <span className="truncate">{activity?.thought}</span>
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

/** True if this job came from pearl-swarm-dispatch's /api/swarm bridge. */
function isSwarmJob(job: ActiveJob): boolean {
  return job.kind === 'swarm' || (job.agents?.length ?? 0) > 1;
}

function isFastDraftJob(job: ActiveJob | CompletedJob): boolean {
  return job.executionMode === 'fast_draft';
}

function trimBubbleText(text: string): string {
  const cleaned = scrubLegacyFableNames(text).replace(/\s+/g, ' ').trim();
  return cleaned.length > 96 ? `${cleaned.slice(0, 93)}...` : cleaned;
}

function shortTaskTitle(job: ActiveJob): string {
  const source = job.fullTitle || job.label || job.description || humanizeLabel(job);
  const title = displayTaskTitle(source).replace(/[.?!]\s*$/, '').trim();
  if (!title || title === 'Task') return 'this task';
  return title.length > 46 ? `${title.slice(0, 43)}...` : title;
}

function agentDialogueFallback(job: ActiveJob, index: number): string {
  const title = shortTaskTitle(job);
  const status = job.rawStatus || job.status;
  const running = status === 'in_progress' || status === 'running';
  const queued = status === 'pending' || status === 'idle';
  const complete = status === 'completed' || status === 'complete';
  const failed = status === 'failed' || status === 'cancelled';
  const runningLines = [
    `Working on ${title}.`,
    'Checking the next step.',
    `Reviewing ${title}.`,
    'Coordinating the handoff.',
  ];
  const queuedLines = [
    `Queued for ${title}.`,
    'Waiting for a worker slot.',
    'Ready to start.',
  ];
  const completeLines = [
    `Finished ${title}.`,
    'Ready for review.',
    'Wrapping up the notes.',
  ];
  const failedLines = [
    `Needs review on ${title}.`,
    'Checking the failure note.',
    'Waiting for a retry decision.',
  ];
  const lines = running ? runningLines : queued ? queuedLines : complete ? completeLines : failed ? failedLines : runningLines;
  return lines[index % lines.length];
}

function AgentEmojiBubbles({ job, compact = false }: { job: ActiveJob; compact?: boolean }) {
  const rawAgents = job.agents && job.agents.length > 0
    ? job.agents
    : job.assignee ? [job.assignee] : ['pearl'];

  const latestNote = latestNoteText(job);

  const items = rawAgents.map((agentId, index) => {
    const swarmThought = agentActivityFor(job, agentId)?.thought || '';
    const thought = trimBubbleText(swarmThought || latestNote || agentDialogueFallback(job, index));
    return { agentId, thought };
  });

  return (
    <div
      className={
        compact
          ? "flex flex-wrap items-start gap-1.5 border-t border-white/5 pt-1"
          : "flex flex-wrap items-start gap-2 pb-2 border-b border-white/5 mb-2"
      }
    >
      {items.map(({ agentId, thought }, idx) => (
        <div key={`${agentId}-${idx}`} className="flex items-start gap-1.5 max-w-full">
          <span
            className={`${compact ? 'text-[15px]' : 'text-[18px]'} leading-none flex-shrink-0 mt-0.5 select-none`}
            title={friendlyAgentName(agentId)}
          >
            {emojiForAgent(agentId)}
          </span>
          {thought && (
            <div
              className={`
                relative px-2 py-1 rounded-lg
                bg-white text-[#1a1025] text-[10px] leading-snug
                shadow-sm shadow-black/30
                ${compact ? 'max-w-[142px]' : 'max-w-[180px]'} break-words
              `}
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              <span
                className="absolute -left-1 top-2 w-0 h-0"
                style={{
                  borderTop: '4px solid transparent',
                  borderBottom: '4px solid transparent',
                  borderRight: '5px solid white',
                }}
              />
              {thought}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function resultNoteId(job: Pick<ActiveJob, 'noteFilename'>): string | null {
  const raw = (job.noteFilename || '').trim();
  if (!raw) return null;
  return raw.replace(/\.md$/i, '');
}

function firstUrl(text: string | null | undefined): string | null {
  const match = (text || '').match(/https?:\/\/[^\s)\]]+/i);
  return match?.[0] ?? null;
}

function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function taskResultDataUrl(job: Pick<ActiveJob, 'result' | 'label'>): string {
  const title = escapeHtmlText(scrubLegacyFableNames(job.label || 'Task Result'));
  const body = escapeHtmlText(scrubLegacyFableNames((job.result || '').trim()) || 'This task completed without a saved result.');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;padding:24px;background:#0f1419;color:#e6edf3;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}h1{font:600 18px/1.3 system-ui,sans-serif;margin:0 0 18px;color:#fff;}pre{white-space:pre-wrap;word-break:break-word;margin:0;}</style></head><body><h1>${title}</h1><pre>${body}</pre></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function openTaskResult(job: Pick<ActiveJob, 'noteFilename' | 'result' | 'artifactUrl' | 'fileSpacePath' | 'label'>) {
  window.dispatchEvent(new CustomEvent('active-jobs:minimize'));
  const fileSpacePath = (job.fileSpacePath || '').trim();
  if (fileSpacePath) {
    requestWindowOpen({
      viewType: 'files',
      title: 'FileSpace',
      source: 'active-jobs:filespace',
      viewState: { fileSpacePath },
      options: { allowDuplicate: true },
    });
    return;
  }

  const artifactUrl = (job.artifactUrl || '').trim();
  if (artifactUrl) {
    requestWindowOpen({
      viewType: 'miniBrowser',
      title: job.label || 'Task App',
      source: 'active-jobs:artifact',
      viewState: { browserUrl: artifactUrl },
      options: { allowDuplicate: true },
    });
    return;
  }

  const noteId = resultNoteId(job);
  if (noteId) {
    requestWindowOpen({
      viewType: 'notes',
      title: 'Notes',
      source: 'active-jobs:result',
      viewState: { openNoteId: noteId },
    });
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('openNoteFromFile', { detail: { noteId } }));
      window.dispatchEvent(new CustomEvent('notepadCommand', {
        detail: { action: 'openNote', payload: { noteId } },
      }));
    }, 160);
    return;
  }

  const url = firstUrl(job.result);
  if (url) {
    requestWindowOpen({
      viewType: 'miniBrowser',
      title: job.label || 'Task Result',
      source: 'active-jobs:url',
      viewState: { browserUrl: url },
      options: { allowDuplicate: true },
    });
    return;
  }

  requestWindowOpen({
    viewType: 'miniBrowser',
    title: job.label || 'Task Result',
    source: 'active-jobs:raw-result',
    viewState: { browserUrl: taskResultDataUrl(job) },
    options: { allowDuplicate: true },
  });
}

function hasTaskResult(job: Pick<ActiveJob, 'noteFilename' | 'result' | 'artifactUrl' | 'fileSpacePath'>): boolean {
  return Boolean(job.fileSpacePath || job.artifactUrl || resultNoteId(job) || firstUrl(job.result) || (job.result || '').trim());
}

function ResultIconButton({ job }: { job: Pick<ActiveJob, 'noteFilename' | 'result' | 'artifactUrl' | 'fileSpacePath' | 'label'> }) {
  if (!hasTaskResult(job)) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openTaskResult(job);
      }}
      className="
        flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md
        border border-emerald-300/30 bg-emerald-400/12 text-emerald-200
        hover:border-emerald-200/50 hover:bg-emerald-400/20 hover:text-white
        transition-colors
      "
      title="Open task result"
      aria-label="Open task result"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h6.25L18 8.5v11.75H7z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 4v5h5M9.5 13h5M9.5 16h5" />
      </svg>
    </button>
  );
}

function FastDraftJobCard({ job }: { job: ActiveJob }) {
  const [elapsedMs, setElapsedMs] = useState(job.elapsedMs);

  useEffect(() => {
    if (job.status !== 'running') {
      setElapsedMs(job.elapsedMs);
      return;
    }
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - job.startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [job.status, job.startedAt, job.elapsedMs]);

  const titleSource = job.fullTitle || job.label || job.description || humanizeLabel(job);
  const label = displayTaskTitle(titleSource);
  const stateText = job.status === 'complete'
    ? 'done'
    : job.status === 'failed'
    ? 'failed'
    : job.status === 'idle'
    ? 'queued'
    : 'working';

  return (
    <div
      className="
        w-full rounded-xl border border-emerald-300/20 bg-emerald-300/[0.08]
        px-3 py-2 shadow-lg shadow-black/25
      "
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusIndicator status={job.status} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-emerald-50">
          ⚡ {label}
        </span>
        <span className="flex-shrink-0 text-[10px] text-emerald-100/55">
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-emerald-100/45">
        Fast draft · {stateText}
      </div>
    </div>
  );
}

function CompletedJobCard({
  job,
  feedbackGiven,
  showInlineFeedback,
  onThumbsUp,
  onThumbsDown,
  onSubmitFeedback,
  onCancelFeedback,
  submittingFeedback,
}: {
  job: CompletedJob;
  feedbackGiven?: 'up' | 'down';
  showInlineFeedback: boolean;
  onThumbsUp: (id: string, label: string) => void;
  onThumbsDown: (id: string, label: string) => void;
  onSubmitFeedback: (feedback: { taskId: string; taskName: string; type: 'down'; notes: string; images: File[]; timestamp: number; mode: 'text'; taskDescription?: string }) => void;
  onCancelFeedback: () => void;
  submittingFeedback: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const desc = job.description;
  const label = displayTaskTitle(job.label || humanizeCompletedLabel(job) || desc || 'Task');

  if (isFastDraftJob(job)) {
    return <FastDraftJobCard job={job} />;
  }

  return (
    <div
      className="w-full transition-all duration-300 ease-out opacity-100 translate-x-0"
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div
        className="
          flex flex-col gap-1.5 px-3 py-2 cursor-pointer select-none
          bg-[#1a1025] border border-white/10 rounded-xl
          hover:border-white/20 hover:bg-[#211530]
          transition-colors duration-200
          shadow-lg shadow-black/30
        "
        style={{ width: '100%' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex min-w-0 items-start gap-2">
          <ResultIconButton job={job} />
          <span className="block text-xs text-white/75 font-medium leading-snug break-words">{label}</span>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-[10px] text-white/30 truncate flex-1">Completed</span>
          <span className="text-[10px] text-white/30 flex-shrink-0">
            {formatTimeAgo(job.completedAt)}
          </span>
          <div onClick={(e) => e.stopPropagation()}>
            <FeedbackButtons
              jobId={job.id}
              jobLabel={label}
              feedbackGiven={feedbackGiven}
              onThumbsUp={onThumbsUp}
              onThumbsDown={onThumbsDown}
            />
          </div>
          <ExpandChevron expanded={expanded} />
        </div>
      </div>

      {/* Expanded panel */}
      <div
        className={`
          overflow-hidden transition-all duration-200 ease-out
          ${expanded ? 'max-h-[200px] mt-1' : 'max-h-0'}
        `}
      >
        <div
          className="
            relative bg-[#0d0815] border border-white/5 rounded-lg
            p-2.5 text-[11px] text-white/50 leading-relaxed
            max-h-[200px] overflow-y-auto aj-scroll
          "
          style={{ width: '100%', fontFamily: 'Gohufont, monospace' }}
        >
          {showTechnical ? (
            <div className="space-y-1 pr-7">
              <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Technical Details</div>
              {(job.agents?.length > 0 || job.model) && (
                <div><span className="text-white/25">Agents:</span> {job.agents?.length > 0 ? job.agents.map(friendlyModel).join(', ') : friendlyModel(job.model)}</div>
              )}
              {job.totalTokens > 0 && <div><span className="text-white/25">Tokens:</span> {job.totalTokens.toLocaleString()}</div>}
              <div><span className="text-white/25">Finished:</span> {new Date(job.completedAt).toLocaleTimeString()}</div>
              {job.channel && <div><span className="text-white/25">Source:</span> {job.channel === 'discord' ? 'Discord' : job.channel === 'webchat' ? 'Web chat' : job.channel}</div>}
            </div>
          ) : (
            <div className="pr-7 text-white/50">{generateHumanSummary(job)}</div>
          )}
          <div className="absolute bottom-2 right-2" onClick={(e) => e.stopPropagation()}>
            <EyeToggleIcon active={showTechnical} onClick={(e) => { e.stopPropagation(); setShowTechnical((v) => !v); }} />
          </div>
        </div>
      </div>

      {/* Inline feedback form (replaces modal) */}
      {showInlineFeedback && (
        <InlineFeedbackForm
          taskId={job.id}
          taskName={label}
          taskDescription={job.description}
          onSubmit={onSubmitFeedback}
          onCancel={onCancelFeedback}
          submitting={submittingFeedback}
        />
      )}
    </div>
  );
}

function JobCard({
  job,
  feedbackGiven,
  showInlineFeedback,
  onThumbsUp,
  onThumbsDown,
  onSubmitFeedback,
  onCancelFeedback,
  submittingFeedback,
  onStart,
  onPause,
  onStop,
  onPrioritize,
  onDeprioritize,
  onCancelTask,
  onAskAgent,
}: {
  job: ActiveJob;
  feedbackGiven?: 'up' | 'down';
  showInlineFeedback: boolean;
  onThumbsUp?: (id: string, label: string) => void;
  onThumbsDown?: (id: string, label: string) => void;
  onSubmitFeedback: (feedback: { taskId: string; taskName: string; type: 'down'; notes: string; images: File[]; timestamp: number; mode: 'text'; taskDescription?: string }) => void;
  onCancelFeedback: () => void;
  submittingFeedback: boolean;
  onStart?: (id: string) => Promise<boolean>;
  onPause?: (id: string) => Promise<boolean>;
  onStop?: (id: string) => Promise<boolean>;
  onPrioritize?: (id: string) => Promise<boolean>;
  onDeprioritize?: (id: string) => Promise<boolean>;
  onCancelTask?: (id: string) => Promise<boolean>;
  onAskAgent?: (id: string, question: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(job.elapsedMs);

  useEffect(() => {
    if (job.status !== 'running') {
      setElapsedMs(job.elapsedMs);
      return;
    }
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - job.startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [job.status, job.startedAt, job.elapsedMs]);

  const desc = job.description;
  // Prefer the server-provided full title so the card shows the actual task
  // name instead of a random prompt prefix/snippet. Fall back to legacy labels.
  const titleSource = job.fullTitle || job.label || desc || humanizeLabel(job);
  const label = displayTaskTitle(titleSource);
  const swarm = isSwarmJob(job);

  if (isFastDraftJob(job)) {
    return <FastDraftJobCard job={job} />;
  }

  return (
    <div
      className={`
        w-full transition-all duration-300 ease-out
        ${job.fadingOut ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'}
      `}
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div
        className={`
          flex flex-col gap-1 px-3 py-2 cursor-pointer select-none
          border rounded-xl
          transition-colors duration-200
          shadow-lg shadow-black/30
          ${swarm
            ? 'bg-[#1f1520] border-amber-400/15 hover:border-amber-400/30 hover:bg-[#281b29]'
            : 'bg-[#1a1025] border-white/10 hover:border-white/20 hover:bg-[#211530]'}
        `}
        style={{ width: '100%' }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Title row only. Everything else moves below so long work names have
            the full card width and controls stop competing with the title. */}
        <div className="flex min-w-0 items-start gap-2">
          {(job.status === 'complete' || job.status === 'failed') && <ResultIconButton job={job} />}
          <span className="block text-xs text-white/90 font-medium leading-snug break-words">{label}</span>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <StatusIndicator status={job.status} />
          <span className="text-[10px] text-white/45 truncate flex-1 min-w-0">{humanizeSubtitle(job)}</span>
          {job.emergency && <PriorityBadge />}
          <span className="text-[10px] text-white/40 flex-shrink-0">
            {formatElapsed(elapsedMs)}
          </span>
          <ExpandChevron expanded={expanded} />
        </div>
      </div>

      {/* Expanded panel — grows to fit content naturally; only the collapsed
          state clamps height so the open/close transition still works. */}
      <div
        className={`
          transition-all duration-200 ease-out
          ${expanded ? 'mt-1' : 'max-h-0 overflow-hidden'}
        `}
      >
        <div
          className="
            relative bg-[#0d0815] border border-white/5 rounded-lg
            p-2.5 text-[11px] text-white/50 leading-relaxed
          "
          style={{ width: '100%', fontFamily: 'Gohufont, monospace' }}
        >
          {expanded && (
            <div className="mb-2 overflow-hidden rounded-lg border border-white/10 bg-[#080d12] p-2" onClick={(e) => e.stopPropagation()}>
              <PearlAgencyRooms focusTask={job} compact />
            </div>
          )}
          {showTechnical ? (
            <div className="space-y-1 pr-7 pt-1">
              <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Technical Details</div>
              <div><span className="text-white/25">Swarm:</span> {swarmDisplay(job)}</div>
              {(job.agents?.length > 0 || job.model) && (
                <div><span className="text-white/25">Agents:</span> {job.agents?.length > 0 ? job.agents.map(friendlyModel).join(', ') : friendlyModel(job.model)}</div>
              )}
              {job.totalTokens > 0 && <div><span className="text-white/25">Tokens:</span> {job.totalTokens.toLocaleString()}</div>}
              <div><span className="text-white/25">Started:</span> {new Date(job.startedAt).toLocaleTimeString()}</div>
              {job.channel && <div><span className="text-white/25">Source:</span> {job.channel === 'discord' ? 'Discord' : job.channel === 'webchat' ? 'Web chat' : job.channel}</div>}
              <div><span className="text-white/25">Status:</span> {job.status}</div>
              {job.urgency && <div><span className="text-white/25">Urgency:</span> {job.urgency}</div>}
            </div>
          ) : (
            <div className="pr-7 pt-1 text-white/55 break-words">
              {desc || generateHumanSummary(job)}
            </div>
          )}

          {/* Full control cluster on the expanded view — the only place the
              action buttons live now. The collapsed card is intentionally clean
              so titles can span the full width. */}
          {(job.status === 'idle' || job.status === 'running' || job.status === 'failed' || ((job.status === 'complete' || job.fadingOut) && onThumbsUp && onThumbsDown)) && (
            <div
              className="mt-2 pt-2 border-t border-white/5 flex flex-wrap items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {(job.status === 'idle' || job.status === 'running' || job.status === 'failed') && (
                <SwarmControls
                  job={job}
                  onStart={onStart}
                  onPause={onPause}
                  onStop={onStop}
                  onPrioritize={onPrioritize}
                  onDeprioritize={onDeprioritize}
                />
              )}
              {(job.status === 'idle' || job.status === 'running') && (
                <AskAgentControl
                  taskId={job.id}
                  taskTitle={label}
                  taskDescription={job.description}
                  onAsk={onAskAgent ? (q) => onAskAgent(job.id, q) : undefined}
                />
              )}
              {onCancelTask && (job.status === 'idle' || job.status === 'running') && (
                <CancelButton onCancel={() => onCancelTask(job.id)} />
              )}
              {(job.status === 'complete' || job.fadingOut) && onThumbsUp && onThumbsDown && (
                <FeedbackButtons
                  jobId={job.id}
                  jobLabel={label}
                  feedbackGiven={feedbackGiven}
                  onThumbsUp={onThumbsUp}
                  onThumbsDown={onThumbsDown}
                />
              )}
            </div>
          )}

          <div className="absolute bottom-2 right-2" onClick={(e) => e.stopPropagation()}>
            <EyeToggleIcon active={showTechnical} onClick={(e) => { e.stopPropagation(); setShowTechnical((v) => !v); }} />
          </div>
        </div>
      </div>

      {/* Inline feedback form (replaces modal) */}
      {showInlineFeedback && (
        <InlineFeedbackForm
          taskId={job.id}
          taskName={label}
          taskDescription={job.description}
          onSubmit={onSubmitFeedback}
          onCancel={onCancelFeedback}
          submitting={submittingFeedback}
        />
      )}
    </div>
  );
}

/** Status dot for polled tasks */
function TaskStatusDot({ status }: { status: PolledTask['status'] }) {
  const colorMap: Record<string, string> = {
    pending: 'bg-gray-400/60',
    running: 'bg-blue-400',
    complete: 'bg-green-400',
    failed: 'bg-red-400',
  };
  const color = colorMap[status] || 'bg-gray-400/60';
  return (
    <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
      <div className={`w-2.5 h-2.5 ${color} rounded-full ${status === 'running' ? 'animate-pulse' : ''}`} />
    </div>
  );
}

/** Status badge for polled tasks (colored pill) */
function TaskStatusBadge({ status, approvalStatus }: { status: PolledTask['status']; approvalStatus?: string }) {
  if (approvalStatus === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-green-400/15 text-green-400/90 border border-green-400/20">
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Approved
      </span>
    );
  }
  if (approvalStatus === 'rejected' || approvalStatus === 'rework') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-red-400/15 text-red-400/90 border border-red-400/20">
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7 9m0 0l7 9M10 12L3 21m7-9l7-9" />
        </svg>
        {approvalStatus === 'rework' ? 'Rework' : 'Rejected'}
      </span>
    );
  }
  const config: Record<string, { bg: string; text: string; border: string; label: string }> = {
    pending:  { bg: 'bg-gray-400/15',  text: 'text-gray-400/90',  border: 'border-gray-400/20',  label: 'Pending' },
    running:  { bg: 'bg-blue-400/15',  text: 'text-blue-400/90',  border: 'border-blue-400/20',  label: 'Running' },
    complete: { bg: 'bg-green-400/15', text: 'text-green-400/90', border: 'border-green-400/20', label: 'Complete' },
    failed:   { bg: 'bg-red-400/15',   text: 'text-red-400/90',   border: 'border-red-400/20',   label: 'Failed' },
  };
  const c = config[status] || config.pending;
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-medium ${c.bg} ${c.text} border ${c.border}`}>
      {c.label}
    </span>
  );
}

/** Card for a task from /api/tasks */
function PolledTaskCard({ task, onApprovalChange }: { task: PolledTask; onApprovalChange?: (taskId: string, action: 'approve' | 'reject') => void }) {
  const [expanded, setExpanded] = useState(false);
  const [screenshotFullscreen, setScreenshotFullscreen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [wrappingUp, setWrappingUp] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusLabel: Record<string, string> = {
    pending: 'Pending',
    running: 'Running',
    complete: 'Complete',
    failed: 'Failed',
  };
  const statusColor: Record<string, string> = {
    pending: 'text-gray-400/70',
    running: 'text-blue-400/80',
    complete: 'text-green-400/80',
    failed: 'text-red-400/80',
  };
  const displayTitle = displayTaskTitle(task.title || 'Task');

  const isApproved = task.approvalStatus === 'approved';
  const isRejected = task.approvalStatus === 'rejected' || task.approvalStatus === 'rework';
  const canVote = task.status === 'complete' && !isApproved && !isRejected;

  // Compute a natural 2-sentence description
  const naturalDescription = task.description || generateNaturalDescription(task);

  // Latest thought (for collapsed capsule)
  const latestThought = task.agentThoughts && task.agentThoughts.length > 0
    ? task.agentThoughts[task.agentThoughts.length - 1].thought
    : undefined;

  // Progress: elapsed / estimated (only meaningful for running tasks)
  const progressPct = (() => {
    if (task.status === 'complete') return 100;
    if (task.status !== 'running') return 0;
    if (!task.estimatedMinutes || !task.createdAt) return 0;
    const elapsedMs = Date.now() - new Date(task.createdAt).getTime();
    const estimatedMs = task.estimatedMinutes * 60 * 1000;
    if (estimatedMs <= 0) return 0;
    return Math.max(3, Math.min(95, Math.round((elapsedMs / estimatedMs) * 100)));
  })();

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      if (dismissTimeoutRef.current) clearTimeout(dismissTimeoutRef.current);
    };
  }, []);

  const triggerDismissal = () => {
    if (isFading || dismissed) return;
    fadeTimeoutRef.current = setTimeout(() => {
      setIsFading(true);
      dismissTimeoutRef.current = setTimeout(() => setDismissed(true), 500);
    }, 3000);
  };

  const handleApproval = async (e: React.MouseEvent, action: 'approve' | 'reject') => {
    e.stopPropagation();
    if (actionPending) return;
    setActionPending(true);
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, taskId: task.taskId }),
      });
      onApprovalChange?.(task.taskId, action);
      triggerDismissal();
    } catch (err) {
      console.error(`[PolledTaskCard] Failed to ${action} task:`, err);
    } finally {
      setActionPending(false);
    }
  };

  const handleWrapUp = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wrappingUp) return;
    setWrappingUp(true);
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'wrapup', taskId: task.taskId }),
      });
    } catch (err) {
      console.error('[PolledTaskCard] Failed to wrap up task:', err);
    } finally {
      setWrappingUp(false);
    }
  };

  if (dismissed) return null;

  return (
    <div
      className={`transition-all duration-300 ease-out ${isFading ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0'} ${(!isFading && isApproved) ? 'opacity-60' : ''}`}
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div
        className={`
          flex flex-col gap-1.5 px-3 py-2 cursor-pointer select-none
          bg-[#1a1025]/70 backdrop-blur-md border rounded-xl
          hover:border-white/20 hover:bg-[#1a1025]/80
          transition-colors duration-200
          shadow-lg shadow-black/30
          ${isApproved ? 'border-green-400/15' : isRejected ? 'border-red-400/15' : 'border-white/10'}
        `}
        style={{ width: '360px', maxWidth: 'calc(100vw - 40px)' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="min-w-0">
          <span className="block text-xs text-white/80 font-medium leading-snug break-words">{displayTitle}</span>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <TaskStatusDot status={task.status} />
          {task.agentName && (task.status === 'running' || task.status === 'pending') ? (
            <div className="min-w-0 flex-1">
              <AgentCapsule
                agentName={task.agentName}
                thought={latestThought}
                estimatedMinutes={task.estimatedMinutes}
              />
            </div>
          ) : (
            <span className={`text-[10px] ${statusColor[task.status] || 'text-white/40'} truncate flex-1 min-w-0`}>
              {task.agentName ? `${friendlyAgentName(task.agentName)} · ` : ''}{statusLabel[task.status] || task.status}
              {task.estimatedMinutes ? ` · ~${task.estimatedMinutes}m` : ''}
            </span>
          )}

          {/* Inline approval indicator for approved/rejected */}
          {isApproved && (
            <div className="flex items-center justify-center w-7 h-7 rounded-lg text-green-400/80 bg-green-400/10 flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {isRejected && (
            <div className="flex items-center justify-center w-7 h-7 rounded-lg text-red-400/80 bg-red-400/10 flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7 9m0 0l7 9M10 12L3 21m7-9l7-9" />
              </svg>
            </div>
          )}

          <ExpandChevron expanded={expanded} />
        </div>

        {task.status === 'running' && progressPct > 0 && (
          <div
            className="h-0.5 w-full rounded-full bg-white/5 overflow-hidden"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Task progress"
          >
            <div
              className="h-full bg-gradient-to-r from-blue-400/70 to-purple-400/70 transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* Wrap It Up button for running tasks */}
        {(task.status === 'running' || canVote) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
          {task.status === 'running' && (
          <button
            onClick={handleWrapUp}
            disabled={wrappingUp}
            className="
              flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium
              bg-amber-500/10 text-amber-300 border border-amber-400/25
              hover:bg-amber-500/20 hover:border-amber-400/40
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors duration-150 mr-1
            "
            title="Ask agent to wrap up and report"
          >
            {wrappingUp ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Wrapping...</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span>Wrap Up</span>
              </>
            )}
          </button>
          )}

          {/* Vote buttons on completed, unvoted tasks */}
          {canVote && (
          <>
            <ApprovalNeededBadge />
            <button
              onClick={(e) => handleApproval(e, 'approve')}
              disabled={actionPending}
              className="
                group w-7 h-7 flex items-center justify-center rounded-lg
                text-white/30 hover:text-green-400
                hover:bg-green-400/10 hover:shadow-[0_0_8px_rgba(74,222,128,0.15)]
                active:scale-90 active:bg-green-400/20
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-200 ease-out
              "
              title="Approve task"
              aria-label="Approve"
            >
              <ThumbUpIcon className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110" />
            </button>
            <button
              onClick={(e) => handleApproval(e, 'reject')}
              disabled={actionPending}
              className="
                group w-7 h-7 flex items-center justify-center rounded-lg
                text-white/30 hover:text-red-400
                hover:bg-red-400/10 hover:shadow-[0_0_8px_rgba(248,113,113,0.15)]
                active:scale-90 active:bg-red-400/20
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-200 ease-out
              "
              title="Reject task"
              aria-label="Reject"
            >
              <ThumbDownIcon className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110" />
            </button>
          </>
          )}
          </div>
        )}
      </div>

      {/* Expanded details panel */}
      <div
        className={`
          overflow-hidden transition-all duration-200 ease-out
          ${expanded ? 'max-h-[400px] mt-1' : 'max-h-0'}
        `}
      >
        <div
          className="relative bg-[#0d0815]/70 backdrop-blur-md border border-white/5 rounded-lg p-2.5 text-[11px] text-white/50 leading-relaxed max-h-[400px] overflow-y-auto aj-scroll"
          style={{ width: '360px', maxWidth: 'calc(100vw - 40px)', fontFamily: 'Gohufont, monospace' }}
        >
          {/* Eye icon to flip between view modes */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowTechnical((v) => !v); }}
            className={`absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md transition-colors ${showTechnical ? 'bg-white/10 text-white/60' : 'text-white/30 hover:text-white/50'}`}
            title={showTechnical ? 'Show visual' : 'Show technical details'}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              {showTechnical ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              )}
              {showTechnical && <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" strokeWidth={2} />}
            </svg>
          </button>

          <div className="space-y-2 pr-7">
            {/* Title — clamped to two lines so a long title can't blow up the
                expanded panel. The full text is still available in the
                description block below if anyone needs it. */}
            <div className="text-xs text-white/90 font-bold leading-snug line-clamp-2 break-words">
              {displayTitle}
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2">
              <TaskStatusBadge status={task.status} approvalStatus={task.approvalStatus} />
            </div>

            {showTechnical ? (
              /* Technical details view */
              <div className="space-y-1 pt-1">
                <div className="text-[10px] text-white/40"><span className="text-white/25">Status:</span> {statusLabel[task.status]}</div>
                {task.agentName && (
                  <div className="text-[10px] text-white/40">
                    <span className="text-white/25">Agent:</span> {friendlyAgentName(task.agentName)}
                  </div>
                )}
                {task.estimatedMinutes !== undefined && task.estimatedMinutes > 0 && (
                  <div className="text-[10px] text-white/40">
                    <span className="text-white/25">Estimate:</span> ~{task.estimatedMinutes} min
                  </div>
                )}
                {task.createdAt && (
                  <div className="text-[10px] text-white/40">
                    <span className="text-white/25">Created:</span> {new Date(task.createdAt).toLocaleString()}
                  </div>
                )}
                {task.updatedAt && task.updatedAt !== task.createdAt && (
                  <div className="text-[10px] text-white/40">
                    <span className="text-white/25">Updated:</span> {new Date(task.updatedAt).toLocaleString()}
                  </div>
                )}
                {task.agentThoughts && task.agentThoughts.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider">Agent Thoughts</div>
                    {task.agentThoughts.map((at, i) => (
                      <div key={i} className="text-[10px] text-white/40 pl-2 border-l border-white/10">
                        <span className="text-white/30">{friendlyAgentName(at.agentId)}:</span> {at.thought}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Visual view - description + agent capsules + screenshot */
              <div className="space-y-2">
                {/* Agent capsule */}
                {task.agentName && (
                  <AgentCapsule
                    agentName={task.agentName}
                    thought={naturalDescription}
                    estimatedMinutes={task.estimatedMinutes}
                  />
                )}

                {/* Description — capped + scrollable so a 3000-char task
                    prompt can't render as a wall of text. The outer panel
                    already scrolls, but bounding the description directly
                    keeps it from pushing other sections offscreen. */}
                {naturalDescription && (
                  <div className="text-[11px] text-white/70 leading-relaxed max-h-[160px] overflow-y-auto aj-scroll whitespace-pre-wrap break-words">
                    {naturalDescription}
                  </div>
                )}

                {/* Agent thought capsules */}
                {task.agentThoughts && task.agentThoughts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {task.agentThoughts.map((at, i) => (
                      <AgentCapsule
                        key={i}
                        agentName={at.agentId}
                        thought={at.thought}
                      />
                    ))}
                  </div>
                )}

                {task.status === 'complete' && task.screenshotUrl && (
                  <div>
                    <img
                      src={task.screenshotUrl}
                      alt="Task screenshot"
                      className="h-[80px] w-auto rounded-lg border border-white/10 cursor-pointer hover:border-white/30 transition-colors duration-150"
                      onClick={(e) => { e.stopPropagation(); setScreenshotFullscreen(true); }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Approve/Reject buttons in expanded view for complete tasks */}
            {canVote && (
              <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => handleApproval(e, 'approve')}
                  disabled={actionPending}
                  className="
                    flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium
                    bg-green-500/15 text-green-300 border border-green-400/25
                    hover:bg-green-500/25 hover:border-green-400/40
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors duration-150
                  "
                >
                  <ThumbUpIcon className="w-3 h-3" />
                  Approve
                </button>
                <button
                  onClick={(e) => handleApproval(e, 'reject')}
                  disabled={actionPending}
                  className="
                    flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium
                    bg-red-500/15 text-red-300 border border-red-400/25
                    hover:bg-red-500/25 hover:border-red-400/40
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors duration-150
                  "
                >
                  <ThumbDownIcon className="w-3 h-3" />
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen screenshot overlay */}
      {screenshotFullscreen && task.screenshotUrl && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setScreenshotFullscreen(false)}
        >
          <img
            src={task.screenshotUrl}
            alt="Task screenshot fullscreen"
            className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
          />
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl"
            onClick={() => setScreenshotFullscreen(false)}
            aria-label="Close fullscreen"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

/** Tasks icon toggle button */
function GearToggleButton({
  count,
  hasRunning,
  hasFailed,
  expanded,
  onClick,
  completedCount,
}: {
  count: number;
  hasRunning: boolean;
  hasFailed: boolean;
  expanded: boolean;
  onClick: () => void;
  completedCount?: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={count > 0
        ? `${count} active job${count !== 1 ? 's' : ''} — tap to ${expanded ? 'collapse' : 'expand'}`
        : `${completedCount || 0} completed tasks — tap to ${expanded ? 'collapse' : 'expand'}`
      }
      className={`
        flex items-center gap-1.5 px-2.5 py-2 rounded-full
        bg-[#0f0820]/80 backdrop-blur-md border border-white/15
        shadow-lg shadow-black/40 shadow-[0_0_12px_rgba(100,60,180,0.2)]
        hover:border-[#FFD233]/40 hover:bg-[#0f0820]/95
        text-[#d4c0e8] hover:text-[#FFD233]
        active:scale-95
        transition-all duration-200
        select-none cursor-pointer
      `}
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      {/* Spinning ring when running */}
      {hasRunning && (
        <div className="relative w-4 h-4 flex-shrink-0">
          <div
            className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"
            style={{ animationDuration: '1.5s' }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
          </div>
        </div>
      )}

      {/* Tasks/list icon */}
      <svg
        className="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>

      {/* Count badge — show active count or completed checkmark */}
      {count > 0 ? (
        <span className="text-xs font-medium leading-none">{count}</span>
      ) : (
        <span className="text-xs font-medium leading-none text-white/30">
          {completedCount ? `✓${completedCount}` : '—'}
        </span>
      )}

      {/* Expand/collapse chevron */}
      <svg
        className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

// ── Task filter / sort ──────────────────────────────────────────────────────
type JobStatusFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
type JobSortBy = 'priority' | 'created' | 'status';
// Source filter retained for internal filtering. The UI no longer surfaces it
// (default 'all') — the previous CLI/Swarm pill row was visual clutter and
// almost no one toggled it. Wire-up remains so power users can re-enable a
// hidden control without re-plumbing the pipeline.
type JobSourceFilter = 'all' | 'cli' | 'swarm';

const FILTERS: Array<{ key: JobStatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'Running' },
  { key: 'completed', label: 'Done' },
  { key: 'failed', label: 'Failed' },
];

// Pixel-style plus icon — matches PixelCheckIcon's NES vibe so + New reads
// as a deliberate UI element instead of generic chrome.
function PixelPlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="6" y="2"  width="4" height="12" />
      <rect x="2" y="6"  width="12" height="4" />
    </svg>
  );
}

// Single-row purple header: + New on the left, a one-tap cycle toggle on the
// right. Each click advances filter through [All, Pending, Running, Done,
// Failed] and wraps. No popover — the previous dropdown menu was extra
// chrome for a control that almost always just needs the next state.
function FilterCycleToggle({
  filter,
  setFilter,
  counts,
}: {
  filter: JobStatusFilter;
  setFilter: (f: JobStatusFilter) => void;
  counts: Partial<Record<JobStatusFilter, number>>;
}) {
  const current = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const currentCount = counts[current.key] ?? 0;

  const cycleNext = () => {
    const idx = FILTERS.findIndex((f) => f.key === filter);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % FILTERS.length;
    setFilter(FILTERS[nextIdx].key);
  };

  return (
    <button
      onClick={cycleNext}
      aria-label={`Filter: ${current.label}. Click to cycle.`}
      className="
        flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium
        bg-white/5 text-white/80 border border-white/15
        hover:bg-white/10 hover:border-white/25
        transition-colors duration-150
      "
      title={`Filter: ${current.label} — click to cycle`}
    >
      <span>{current.label}</span>
      {currentCount > 0 && <span className="text-white/40">{currentCount}</span>}
      <svg
        className="w-2.5 h-2.5 text-white/50"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8a6 6 0 0110-4.5L16 5M16 12a6 6 0 01-10 4.5L4 15" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v3h-3M4 18v-3h3" />
      </svg>
    </button>
  );
}

function JobsHeaderBar({
  filter,
  setFilter,
  counts,
  onNewTask,
  onAgencyClick,
}: {
  filter: JobStatusFilter;
  setFilter: (f: JobStatusFilter) => void;
  counts: Partial<Record<JobStatusFilter, number>>;
  onNewTask: () => void;
  onAgencyClick: () => void;
}) {
  return (
    <div
      className="
        grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 py-1 rounded-xl
        bg-[#0d0815] border border-white/10
        shadow-lg shadow-black/30
      "
      style={{ width: '100%', fontFamily: 'Gohufont, monospace' }}
    >
      <div className="flex min-w-0 items-center justify-start">
        <button
          onClick={onNewTask}
          title="New task — open chat"
          aria-label="New task"
          className="
            group flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium
            bg-purple-500/15 text-purple-200/90 border border-purple-400/30
            hover:bg-purple-500/25 hover:border-purple-400/50
            transition-colors duration-150 flex-shrink-0
          "
        >
          <PixelPlusIcon className="w-2.5 h-2.5 transition-transform duration-150 group-hover:scale-110" />
          <span>New</span>
        </button>
      </div>
      <button
        type="button"
        onClick={onAgencyClick}
        title="Open The Agency"
        aria-label="Open The Agency"
        className="flex h-12 w-12 items-center justify-center overflow-visible rounded-md border border-transparent p-0 hover:border-white/15 hover:bg-white/5"
      >
        <AgencyLogoMark className="h-[60px] w-auto max-w-none object-contain drop-shadow-[0_0_8px_rgba(255,210,51,0.18)]" />
      </button>
      <div className="flex min-w-0 items-center justify-end">
        <FilterCycleToggle filter={filter} setFilter={setFilter} counts={counts} />
      </div>
    </div>
  );
}

function jobMatchesFilter(job: ActiveJob, f: JobStatusFilter): boolean {
  // Failed tasks live in their own bin (dedicated tab + footer modal) so the
  // main `all` view stays focused on work still in flight. QA can audit the
  // failures via the Failed tab or the "N failed" footer link.
  if (f === 'all') return job.status !== 'failed';
  switch (f) {
    case 'pending':     return job.rawStatus === 'pending' || job.status === 'idle';
    case 'in_progress': return job.status === 'running';
    case 'completed':   return job.rawStatus === 'completed' || (job.status === 'complete' && job.rawStatus !== 'cancelled');
    case 'failed':      return job.status === 'failed';
    case 'cancelled':   return job.rawStatus === 'cancelled';
    default:            return true;
  }
}

function sortJobs(list: ActiveJob[], sortBy: JobSortBy): ActiveJob[] {
  const copy = list.slice();
  if (sortBy === 'priority') {
    // Emergency first, then urgent, then running, then newer
    const rank = (j: ActiveJob) => {
      const emergency = j.emergency ? 0 : 1;
      const urgent = j.urgency === 'urgent' ? 0 : 1;
      const running = j.status === 'running' ? 0 : j.status === 'idle' ? 1 : 2;
      return emergency * 100 + urgent * 10 + running;
    };
    copy.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  } else if (sortBy === 'created') {
    copy.sort((a, b) => b.startedAt - a.startedAt);
  } else if (sortBy === 'status') {
    const order: Record<ActiveJob['status'], number> = { running: 0, idle: 1, failed: 2, complete: 3 };
    copy.sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt);
  }
  return copy;
}

const COMPLETED_DEFAULT_CAP = 20;

// ────────────────────────────────────────────────────────────────────────────
// Pixel-style checkmark — matches the rest of the dark PearlOS chrome.
// ────────────────────────────────────────────────────────────────────────────
function PixelCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Chunky pixel check: steps down, then up, like NES UI ticks */}
      <rect x="2" y="8"  width="2" height="2" />
      <rect x="4" y="10" width="2" height="2" />
      <rect x="6" y="12" width="2" height="2" />
      <rect x="8" y="10" width="2" height="2" />
      <rect x="10" y="8" width="2" height="2" />
      <rect x="12" y="6" width="2" height="2" />
    </svg>
  );
}


function ArchiveModal({
  open,
  onClose,
  onRestore,
  fetchArchived,
}: {
  open: boolean;
  onClose: () => void;
  onRestore: (id: string) => Promise<boolean>;
  fetchArchived: () => Promise<ActiveJob[]>;
}) {
  const [items, setItems] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchArchived();
      setItems(next);
    } finally {
      setLoading(false);
    }
  }, [fetchArchived]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try {
      const ok = await onRestore(id);
      if (ok) {
        // Drop the restored row so the modal reflects the change immediately.
        setItems((cur) => cur.filter((c) => c.id !== id));
      }
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Archived tasks"
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div
        className="
          relative bg-[#0d0815]/95 border border-white/15 rounded-2xl
          shadow-2xl shadow-black/50 overflow-hidden
          w-[min(540px,calc(100vw-32px))] max-h-[min(640px,calc(100dvh-64px))]
          flex flex-col
        "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <PixelCheckIcon className="w-4 h-4 text-green-300/80" />
          <div className="text-sm text-white/80 font-medium">Archived Tasks</div>
          <div className="flex-1" />
          <span className="text-[10px] text-white/30">{items.length} archived</span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
            aria-label="Close archive"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto aj-scroll p-3 space-y-1.5">
          {loading && (
            <div className="px-3 py-6 text-center text-[11px] text-white/35">Loading archived tasks…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-white/35">
              Nothing archived yet. Use <span className="text-green-300/70">Clear Finished</span> to sweep completed tasks here.
            </div>
          )}
          {!loading && items.map((job) => (
            <div
              key={job.id}
              className="
                flex items-center gap-2 px-3 py-2 rounded-lg
                bg-[#1a1025]/60 border border-white/8 hover:border-white/15
                transition-colors
              "
            >
              <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                <div className="w-1.5 h-1.5 bg-white/35 rounded-full" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[11px] text-white/70 truncate">{job.label || 'Completed task'}</span>
                <span className="text-[9px] text-white/30 truncate">
                  {new Date(job.updatedAt).toLocaleString()} · {job.assignee || 'unassigned'}
                </span>
              </div>
              <button
                onClick={() => void handleRestore(job.id)}
                disabled={restoringId === job.id}
                className="
                  px-2 py-1 rounded-md text-[10px] font-medium
                  bg-blue-500/15 text-blue-300 border border-blue-400/30
                  hover:bg-blue-500/25 hover:border-blue-400/50
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors duration-150
                "
                title="Restore to pending"
              >
                {restoringId === job.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Small red-toned error icon for the Failed bin header.
function PixelFailIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="3"  y="3"  width="2" height="2" />
      <rect x="5"  y="5"  width="2" height="2" />
      <rect x="7"  y="7"  width="2" height="2" />
      <rect x="9"  y="5"  width="2" height="2" />
      <rect x="11" y="3"  width="2" height="2" />
      <rect x="9"  y="9"  width="2" height="2" />
      <rect x="11" y="11" width="2" height="2" />
      <rect x="5"  y="9"  width="2" height="2" />
      <rect x="3"  y="11" width="2" height="2" />
    </svg>
  );
}

// Pick the most relevant error snippet from the task's notes. The backend
// appends lines like "Attempt #N failed: <reason>. ..." — surface the newest
// failure reason so QA can skim without opening the raw log.
function extractFailureReason(job: ActiveJob): string | null {
  const notes = job.notes ?? [];
  for (let i = notes.length - 1; i >= 0; i -= 1) {
    const text = notes[i]?.text ?? '';
    if (/fail|error|exception|traceback/i.test(text)) return text;
  }
  if (job.result && typeof job.result === 'string' && job.result.trim()) {
    return job.result;
  }
  return notes.length > 0 ? notes[notes.length - 1].text : null;
}

function FailedTasksModal({
  open,
  onClose,
  onRetry,
  fetchFailed,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: (id: string) => Promise<boolean>;
  fetchFailed: () => Promise<ActiveJob[]>;
}) {
  const [items, setItems] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchFailed();
      setItems(next);
    } finally {
      setLoading(false);
    }
  }, [fetchFailed]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const handleRetry = async (id: string) => {
    setPendingId(id);
    try {
      const ok = await onRetry(id);
      if (ok) setItems((cur) => cur.filter((c) => c.id !== id));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Failed tasks"
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div
        className="
          relative bg-[#0d0815]/95 border border-red-400/20 rounded-2xl
          shadow-2xl shadow-black/50 overflow-hidden
          w-[min(620px,calc(100vw-32px))] max-h-[min(720px,calc(100dvh-64px))]
          flex flex-col
        "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <PixelFailIcon className="w-4 h-4 text-red-300/90" />
          <div className="text-sm text-white/80 font-medium">Failed Tasks</div>
          <div className="flex-1" />
          <span className="text-[10px] text-white/30">{items.length} failed</span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
            aria-label="Close failed tasks"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto aj-scroll p-3 space-y-2">
          {loading && (
            <div className="px-3 py-6 text-center text-[11px] text-white/35">Loading failed tasks…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-white/35">
              No failed tasks. When a task fails, it lands here for QA audit.
            </div>
          )}
          {!loading && items.map((job) => {
            const reason = extractFailureReason(job);
            const expanded = expandedId === job.id;
            const allNotes = job.notes ?? [];
            return (
              <div
                key={job.id}
                className="
                  flex flex-col gap-2 px-3 py-2 rounded-lg
                  bg-[#1a0d10]/50 border border-red-400/15 hover:border-red-400/25
                  transition-colors
                "
              >
                <div className="flex items-start gap-2">
                  <div className="flex items-center justify-center w-4 h-4 flex-shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 bg-red-400/70 rounded-full" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[11px] text-white/80 truncate">{job.label || 'Failed task'}</span>
                    <span className="text-[9px] text-white/30 truncate">
                      {new Date(job.updatedAt).toLocaleString()} · {job.assignee || 'unassigned'}
                      {typeof job.retryCount === 'number' && job.retryCount > 0
                        ? ` · ${job.retryCount} retr${job.retryCount === 1 ? 'y' : 'ies'}`
                        : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => void handleRetry(job.id)}
                    disabled={pendingId === job.id}
                    className="
                      px-2 py-1 rounded-md text-[10px] font-medium
                      bg-blue-500/15 text-blue-300 border border-blue-400/30
                      hover:bg-blue-500/25 hover:border-blue-400/50
                      disabled:opacity-40 disabled:cursor-not-allowed
                      transition-colors duration-150
                    "
                    title="Re-queue as pending so the worker picks it up again"
                  >
                    {pendingId === job.id ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
                {reason && (
                  <div className="pl-6">
                    <div className="text-[10px] text-red-200/80 bg-red-500/5 border border-red-400/15 rounded px-2 py-1.5 whitespace-pre-wrap break-words">
                      {reason}
                    </div>
                    {allNotes.length > 1 && (
                      <button
                        onClick={() => setExpandedId(expanded ? null : job.id)}
                        className="mt-1 text-[9px] text-white/35 hover:text-white/60 transition-colors"
                      >
                        {expanded
                          ? '▾ Hide full history'
                          : `▸ Show full history (${allNotes.length} note${allNotes.length === 1 ? '' : 's'})`}
                      </button>
                    )}
                    {expanded && (
                      <div className="mt-1 space-y-1">
                        {allNotes.map((note, idx) => (
                          <div
                            key={`${note.ts}-${idx}`}
                            className="text-[9px] text-white/50 bg-[#0d0815]/60 border border-white/5 rounded px-2 py-1 whitespace-pre-wrap break-words"
                          >
                            <span className="text-white/30">{new Date(note.ts).toLocaleString()}</span>
                            {note.kind ? <span className="text-white/30"> · {note.kind}</span> : null}
                            <span className="block text-white/60">{note.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ToastBanner({ toast, onDismiss }: { toast: WidgetToast | null; onDismiss: () => void }) {
  if (!toast) return null;
  const tone =
    toast.kind === 'success'
      ? 'border-green-400/30 text-green-200 bg-[#0d1a12]/90'
      : toast.kind === 'error'
      ? 'border-red-400/30 text-red-200 bg-[#1a0d10]/90'
      : 'border-white/15 text-white/80 bg-[#0d0815]/90';
  return (
    <div
      onClick={onDismiss}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
          event.preventDefault();
          onDismiss();
        }
      }}
      className={`
        flex items-center gap-2 px-3 py-2 rounded-xl
        ${tone} backdrop-blur-md border shadow-lg shadow-black/40
        animate-in slide-in-from-top-2 duration-150 cursor-pointer
      `}
      style={{ minWidth: '280px', maxWidth: 'min(360px, calc(100vw - 40px))', fontFamily: 'Gohufont, monospace' }}
      role="button"
      tabIndex={0}
      aria-label={`Dismiss notification: ${toast.message}`}
    >
      <span className="text-[11px] flex-1">{toast.message}</span>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className="w-5 h-5 flex items-center justify-center rounded text-white/50 hover:text-white/80 transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ActiveJobsWidget() {
  const {
    jobs,
    completedHistory,
    toast,
    dismissToast,
    startTask,
    pauseTask,
    stopTask,
    prioritizeTask,
    deprioritizeTask,
    cancelTask,
    askPearlAboutTask,
    clearFinished,
    restoreTask,
    archiveTask,
    requeueTask,
    refreshJobs,
    fetchArchived,
    fetchFailed,
  } = useActiveJobs();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [failedModalOpen, setFailedModalOpen] = useState(false);
  const [newTaskModalOpen, setNewTaskModalOpen] = useState(false);

  // Refresh the archived-count badge whenever the sweep runs or the modal
  // closes. Cheap — single GET with status=archived&limit=500.
  const refreshArchivedCount = useCallback(async () => {
    const items = await fetchArchived();
    setArchivedCount(items.length);
  }, [fetchArchived]);

  useEffect(() => {
    void refreshArchivedCount();
  }, [refreshArchivedCount]);

  const handleClearFinished = useCallback(async () => {
    await clearFinished({ includeCancelled: true });
    void refreshArchivedCount();
  }, [clearFinished, refreshArchivedCount]);

  const handleRestore = useCallback(
    async (id: string) => {
      const ok = await restoreTask(id);
      if (ok) void refreshArchivedCount();
      return ok;
    },
    [restoreTask, refreshArchivedCount],
  );

  // Retry a failed task by re-queueing it as pending+urgent so the worker
  // picks it up next. Dismiss simply deletes the task from the backend so it
  // drops out of the audit log.
  const handleRetryFailed = useCallback(
    async (id: string) => {
      return startTask(id);
    },
    [startTask],
  );
  const { effectiveIsMobile } = useLayoutMode();
  const { wonderChromeMode } = useUI();
  const [wonderSceneId, setWonderSceneId] = useState<string | null>(null);

  const wonderJobsHidden = wonderChromeMode === 'full';

  useEffect(() => {
    const handleWonderScene = (e: Event) => {
      const payload = (e as CustomEvent).detail?.payload ?? {};
      if (payload.sceneId) {
        setWonderSceneId(String(payload.sceneId));
      }
    };
    const handleWonderClear = () => {
      setWonderSceneId(null);
    };
    window.addEventListener('nia:wonder.scene', handleWonderScene);
    window.addEventListener('nia:wonder.clear', handleWonderClear);
    return () => {
      window.removeEventListener('nia:wonder.scene', handleWonderScene);
      window.removeEventListener('nia:wonder.clear', handleWonderClear);
    };
  }, []);

  const isMobile = effectiveIsMobile;
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const { currentMode } = useDesktopMode();
  const {
    feedbackState,
    inlineFeedbackTaskId,
    submitting,
    handleThumbsUp: rawThumbsUp,
    openInlineFeedback,
    closeInlineFeedback,
    submitFeedback: rawSubmitFeedback,
  } = useTaskFeedback();

  const handleThumbsUp = useCallback(async (taskId: string, taskName: string) => {
    await rawThumbsUp(taskId, taskName);
    void archiveTask(taskId);
  }, [rawThumbsUp, archiveTask]);

  const handleThumbsDown = useCallback((taskId: string, taskName: string) => {
    openInlineFeedback(taskId, taskName);
  }, [openInlineFeedback]);

  const handleSubmitInlineFeedback = useCallback(async (feedback: { taskId: string; taskName: string; type: 'down'; notes: string; images: File[]; timestamp: number; mode: 'text'; taskDescription?: string }) => {
    await rawSubmitFeedback(feedback);
    await requeueTask(feedback.taskId, feedback.notes);
  }, [rawSubmitFeedback, requeueTask]);

  useEffect(() => {
    setMobileExpanded(false);
  }, [currentMode]);

  useEffect(() => {
    const handleMinimize = () => {
      setMobileExpanded(false);
      setDesktopExpanded(false);
    };
    window.addEventListener('active-jobs:minimize', handleMinimize);
    return () => window.removeEventListener('active-jobs:minimize', handleMinimize);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const desktopContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureGohufont();
    ensureActiveJobsScrollbarCss();
  }, []);

  const [filter, setFilter] = useState<JobStatusFilter>('all');
  const [showAllCompleted, setShowAllCompleted] = useState(false);

  // Sort and source filter: previously had pill rows in the header; pulled
  // out of the UI to keep the top bar single-row. Defaults — priority sort,
  // all sources — match what users picked ~99% of the time.
  const sortBy: JobSortBy = 'priority';
  const sourceFilter: JobSourceFilter = 'all';

  const completedIds = new Set(completedHistory.map((j) => j.id));
  const activePool = jobs.filter(
    (j) => (j.status === 'running' || j.status === 'complete' || j.status === 'failed' || j.status === 'idle' || j.label)
      && !completedIds.has(j.id)
  );

  const sourceFilteredPool = activePool.filter((j) => {
    if (sourceFilter === 'all') return true;
    return sourceFilter === 'swarm' ? isSwarmJob(j) : !isSwarmJob(j);
  });

  const filterCounts: Partial<Record<JobStatusFilter, number>> = {
    all: sourceFilteredPool.filter((j) => jobMatchesFilter(j, 'all')).length,
    pending: sourceFilteredPool.filter((j) => jobMatchesFilter(j, 'pending')).length,
    in_progress: sourceFilteredPool.filter((j) => jobMatchesFilter(j, 'in_progress')).length,
    completed: completedHistory.length,
    failed: sourceFilteredPool.filter((j) => jobMatchesFilter(j, 'failed')).length,
  };

  const visibleJobs = sortJobs(sourceFilteredPool.filter((j) => jobMatchesFilter(j, filter)), sortBy);
  const visibleCompleted = showAllCompleted
    ? completedHistory
    : completedHistory.slice(0, COMPLETED_DEFAULT_CAP);
  const hiddenCompletedCount = Math.max(0, completedHistory.length - visibleCompleted.length);

  const hasActiveJobs = visibleJobs.length > 0;
  const hasRunning = visibleJobs.some((j) => j.status === 'running');
  const hasFailed = visibleJobs.some((j) => j.status === 'failed');

  // Count of finished rows that "Clear Finished" would archive — completed
  // history plus any still-visible cancelled task. Failed tasks are excluded
  // because the backend refuses to archive them.
  const finishedCount =
    completedHistory.length +
    activePool.filter((j) => j.rawStatus === 'cancelled').length;

  const handleNewTask = useCallback(() => {
    setNewTaskModalOpen(true);
  }, []);

  const openAgencyApp = useCallback(() => {
    setMobileExpanded(false);
    setDesktopExpanded(false);
    requestWindowClose({ viewType: 'agency', source: 'active-jobs-logo' });
    requestWindowOpen({ viewType: 'agency', source: 'active-jobs-logo', options: { allowDuplicate: false } });
  }, []);

  const [confirmingClearFinished, setConfirmingClearFinished] = useState(false);
  const [clearingFinished, setClearingFinished] = useState(false);
  const runClearFinished = useCallback(async () => {
    if (clearingFinished) return;
    setClearingFinished(true);
    try {
      await handleClearFinished();
    } finally {
      setClearingFinished(false);
      setConfirmingClearFinished(false);
    }
  }, [clearingFinished, handleClearFinished]);

  // Shared job list rendering
  const renderJobList = () => (
    <>
      {/* Early Access Feedback cell — text-only, no code execution path */}
      <EarlyAccessFeedbackCell isMobile={isMobile} />

      {/* Single purple bar: + New on the left, status filter pills on the
          right. Replaces the old 3-row stack (Clear Finished / status pills /
          source+sort pills). Sweep + archive moved to the footer. */}
      <JobsHeaderBar
        filter={filter}
        setFilter={setFilter}
        counts={filterCounts}
        onNewTask={handleNewTask}
        onAgencyClick={openAgencyApp}
      />
      <NewTaskModal
        open={newTaskModalOpen}
        onClose={() => setNewTaskModalOpen(false)}
        onCreated={() => void refreshJobs()}
      />
      {/* Active job cards */}
      {hasActiveJobs && (
        <div
          className="flex w-full flex-col items-center gap-2"
        >
          {visibleJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              feedbackGiven={feedbackState.submitted.get(job.id)}
              showInlineFeedback={inlineFeedbackTaskId === job.id}
              onThumbsUp={handleThumbsUp}
              onThumbsDown={handleThumbsDown}
              onSubmitFeedback={handleSubmitInlineFeedback}
              onCancelFeedback={closeInlineFeedback}
              submittingFeedback={submitting}
              onStart={startTask}
              onPause={pauseTask}
              onStop={stopTask}
              onPrioritize={prioritizeTask}
              onDeprioritize={deprioritizeTask}
              onCancelTask={cancelTask}
              onAskAgent={askPearlAboutTask}
            />
          ))}
        </div>
      )}

      {/* Completed jobs history (filtered out when a non-completed filter is active) */}
      {(filter === 'all' || filter === 'completed') && visibleCompleted.length > 0 && (
        <>
          {hasActiveJobs && (
            <div className="text-[10px] text-white/30 px-2 py-0.5 uppercase tracking-wider" style={{ fontFamily: 'Gohufont, monospace' }}>
              ─── completed ───
            </div>
          )}
          {visibleCompleted.map((job) => (
            <CompletedJobCard
              key={job.id}
              job={job}
              feedbackGiven={feedbackState.submitted.get(job.id)}
              showInlineFeedback={inlineFeedbackTaskId === job.id}
              onThumbsUp={handleThumbsUp}
              onThumbsDown={handleThumbsDown}
              onSubmitFeedback={handleSubmitInlineFeedback}
              onCancelFeedback={closeInlineFeedback}
              submittingFeedback={submitting}
            />
          ))}
          {hiddenCompletedCount > 0 && (
            <button
              onClick={() => setShowAllCompleted(true)}
              className="
                self-center px-2.5 py-1 rounded-md text-[10px] font-medium
                text-white/50 bg-white/5 border border-white/10
                hover:text-white/80 hover:border-white/20 hover:bg-white/10
                transition-colors
              "
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              Show {hiddenCompletedCount} older {hiddenCompletedCount === 1 ? 'task' : 'tasks'}
            </button>
          )}
          {showAllCompleted && completedHistory.length > COMPLETED_DEFAULT_CAP && (
            <button
              onClick={() => setShowAllCompleted(false)}
              className="
                self-center px-2.5 py-1 rounded-md text-[10px] font-medium
                text-white/40 hover:text-white/70 transition-colors
              "
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              Collapse to last {COMPLETED_DEFAULT_CAP}
            </button>
          )}
        </>
      )}

      {/* Empty state */}
      {/* Footer link cluster — Clear Finished, Archive, Failed all live
          here together (instead of a header card + two separate footer
          links) so the top of the widget stays uncluttered. */}
      {(finishedCount > 0 || archivedCount > 0 || (filterCounts.failed ?? 0) > 0) && (
        confirmingClearFinished ? (
          <div
            className="
              flex items-center gap-1.5 self-center px-2 py-1 rounded-md
              bg-[#0d0815] border border-green-400/30
            "
            style={{ fontFamily: 'Gohufont, monospace' }}
          >
            <span className="text-[10px] text-white/70">Clear all completed?</span>
            <button
              onClick={() => setConfirmingClearFinished(false)}
              disabled={clearingFinished}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white/50 border border-white/10 hover:border-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void runClearFinished()}
              disabled={clearingFinished}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-200 border border-green-400/40 hover:bg-green-500/30 transition-colors disabled:opacity-40"
            >
              {clearingFinished ? 'Archiving…' : 'Confirm'}
            </button>
          </div>
        ) : (
          <div
            className="flex items-center gap-3 self-center px-1"
            style={{ fontFamily: 'Gohufont, monospace' }}
          >
            {finishedCount > 0 && (
              <button
                onClick={() => setConfirmingClearFinished(true)}
                className="
                  group flex items-center gap-1 text-[10px] font-medium
                  text-green-300/70 hover:text-green-200 transition-colors
                "
                title="Archive all completed tasks"
                aria-label="Clear finished tasks"
              >
                <PixelCheckIcon className="w-2.5 h-2.5 transition-transform duration-150 group-hover:scale-110" />
                <span>Clear Finished · {finishedCount}</span>
              </button>
            )}
            {archivedCount > 0 && (
              <button
                onClick={() => setArchiveOpen(true)}
                className="text-[10px] font-medium text-white/40 hover:text-white/75 transition-colors"
                title="Open archived tasks"
              >
                Archive · {archivedCount}
              </button>
            )}
            {(filterCounts.failed ?? 0) > 0 && (
              <button
                onClick={() => setFailedModalOpen(true)}
                className="text-[10px] font-medium text-red-300/60 hover:text-red-200 transition-colors"
                title="Open failed tasks"
              >
                Failed · {filterCounts.failed} →
              </button>
            )}
          </div>
        )
      )}
    </>
  );

  const baseRightPx = 56; // Tailwind right-14
  const sceneRightShift: Record<string, number> = {
    // News has the most header controls, so shift it further left.
    news: 0,
    // Weather needs a smaller offset than news but still enough to clear its controls.
    weather: 0,
  };
  const extraRightPx = wonderSceneId ? sceneRightShift[wonderSceneId] ?? 0 : 0;
  const computedRight = baseRightPx + extraRightPx;

  // Overlays (archive modal + failed-tasks modal + toast) are shared between
  // desktop and mobile.
  const overlays = (
    <>
      <ArchiveModal
        open={archiveOpen}
        onClose={() => {
          setArchiveOpen(false);
          void refreshArchivedCount();
        }}
        onRestore={handleRestore}
        fetchArchived={fetchArchived}
      />
      <FailedTasksModal
        open={failedModalOpen}
        onClose={() => setFailedModalOpen(false)}
        onRetry={handleRetryFailed}
        fetchFailed={fetchFailed}
      />
      {toast && (
        <div
          className="fixed z-[550] flex flex-col items-end gap-1.5"
          style={{ top: 'calc(0.75rem + 52px)', right: '10px' }}
        >
          <ToastBanner toast={toast} onDismiss={dismissToast} />
        </div>
      )}
    </>
  );

  // ── Desktop ─────────────────────────────
  if (!isMobile) {
    return (
      <>
        <div
          ref={desktopContainerRef}
          className={`fixed top-3 z-[450] flex flex-col items-end gap-2 transition-opacity duration-200 ${wonderJobsHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          style={{ pointerEvents: wonderJobsHidden ? 'none' : 'auto', right: `${computedRight}px` }}
        >
          {/* Pill button — ALWAYS visible */}
          <div className={desktopExpanded ? 'flex justify-end' : ''}>
            <GearToggleButton
              count={visibleJobs.length}
              hasRunning={hasRunning}
              hasFailed={hasFailed}
              expanded={desktopExpanded}
              onClick={() => setDesktopExpanded((v) => !v)}
              completedCount={completedHistory.length}
            />
          </div>

          {/* Expanded job list — centered, same width as the title bars. */}
          {desktopExpanded && (
            <div
              className="fixed left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 aj-scroll"
              style={{
                top: 'calc(0.75rem + 44px)',
                zIndex: 450,
                width: '95vw',
                maxHeight: 'calc(100dvh - 80px)',
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {renderJobList()}
            </div>
          )}
        </div>
        {overlays}
      </>
    );
  }

  // ── Mobile ────────────────────────────
  return (
    <>
      <div
        ref={containerRef}
        className={`fixed z-[450] flex flex-col items-end gap-2 transition-opacity duration-200 ${wonderJobsHidden ? 'opacity-0' : 'opacity-100'}`}
        style={{
          pointerEvents: 'none',
          // Match top-3 with PersistentNavButtons + Wonder close (mobile close is ~12px + safe-area).
          // News used to use a larger top offset when the Wonder X sat at 56px; that is no longer needed.
          top: '0.75rem',
          right: `${computedRight}px`,
        }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          <GearToggleButton
            count={visibleJobs.length}
            hasRunning={hasRunning}
            hasFailed={hasFailed}
            expanded={mobileExpanded}
            onClick={() => setMobileExpanded((v) => !v)}
            completedCount={completedHistory.length}
          />
        </div>

        <div
          className={`
            flex flex-col gap-1.5 aj-scroll
            transition-all duration-300 ease-out origin-top-right
            ${mobileExpanded ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}
          `}
          style={{
            pointerEvents: mobileExpanded ? 'auto' : 'none',
            position: 'fixed',
            left: '2.5vw',
            right: '2.5vw',
            top: 'calc(0.75rem + 44px)',
            width: '95vw',
            alignItems: 'center',
            // Fill to the bottom of the dynamic viewport, then pad past Safari's
            // bottom toolbar using safe-area-inset so the last task card is not
            // clipped. 16px of breathing room on top lets the fade mask land
            // cleanly without eating the first card.
            maxHeight: mobileExpanded
              ? 'calc(100dvh - 0.75rem - 44px - env(safe-area-inset-bottom, 0px) - 8px)'
              : '0px',
            paddingTop: '16px',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            transition: 'opacity 0.3s ease-out, transform 0.3s ease-out, max-height 0.3s ease-out',
            // Soft fade at the top edge so scrolled content fades under the
            // pill button instead of ending in a harsh horizontal line.
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 4px), transparent 100%)',
            maskImage:
              'linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 4px), transparent 100%)',
          }}
        >
          {renderJobList()}
        </div>
      </div>
      {overlays}
    </>
  );
}
