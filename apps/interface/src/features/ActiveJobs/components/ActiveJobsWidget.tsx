'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useActiveJobs, type ActiveJob, type CompletedJob } from '../hooks/useActiveJobs';
import { useLayoutMode } from '@interface/contexts/layout-mode-context';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useTaskFeedback } from '../hooks/useTaskFeedback';
import { TaskFeedbackModal } from './TaskFeedbackModal';

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

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Turn internal job labels into plain English */
function humanizeLabel(job: ActiveJob): string {
  const raw = job.label || job.displayName || job.key || 'Task';

  // Cron jobs: strip "Cron: " prefix and humanize the slug
  if (raw.startsWith('Cron: ') || job.kind === 'cron') {
    const slug = raw.replace(/^Cron:\s*/, '');
    // Known cron job names → friendly labels
    const cronNames: Record<string, string> = {
      'voice-pipeline-healthcheck': 'Voice system health check',
      'pre-release-health-monitor': 'Release readiness check',
      'voice-pipeline-health': 'Voice system health check',
      'desktop-icon-overhaul': 'Desktop icon redesign',
      'desktop-icon-overhaul-swarm-v2': 'Desktop icon redesign',
    };
    for (const [key, label] of Object.entries(cronNames)) {
      if (slug.includes(key)) return label;
    }
    // Generic: strip version/swarm suffixes, then convert kebab-case to title case
    return slug
      .replace(/-v\d+$/i, '')
      .replace(/-swarm(-v\d+)?$/i, '')
      .replace(/-/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // Sub-agents: clean up the label
  if (job.kind === 'subagent') {
    // Strip technical prefixes and bare UUIDs
    const cleaned = raw
      .replace(/^agent:main:subagent:/, '')
      .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Background task');

    // Known sub-agent labels → friendly names (kept in sync with job-descriptions.json)
    const agentNames: Record<string, string> = {
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

    for (const [key, label] of Object.entries(agentNames)) {
      if (cleaned.includes(key)) return label;
    }

    // Generic: convert kebab-case slug to title case
    return cleaned
      .replace(/-v\d+$/i, '')
      .replace(/-/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  return raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Subtitle line: short human-readable context for what kind of task this is */
function humanizeSubtitle(job: ActiveJob): string {
  const kindLabel = job.kind === 'cron'
    ? 'Scheduled check'
    : job.kind === 'subagent'
    ? 'Background task'
    : 'Task';

  if (job.status === 'failed') return `${kindLabel} · something went wrong`;
  if (job.status === 'complete') return `${kindLabel} · done`;
  if (job.status === 'running') {
    // Try to generate a more useful active-verb subtitle from description
    const desc = job.description || '';
    const label = humanizeLabel(job);
    // If we have a meaningful description (different from the label), derive a short verb phrase
    if (desc && desc.toLowerCase() !== label.toLowerCase()) {
      // Truncate to ~50 chars for subtitle use
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
  // idle
  return (
    <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
      <div className="w-2.5 h-2.5 bg-yellow-400/60 rounded-full" />
    </div>
  );
}

function ExpandChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-white/40 transition-transform duration-200 flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

/** Format model name to be friendly */
function friendlyModel(model: string): string {
  if (!model) return '';
  const name = model.split('/').pop() || model;
  const modelNames: Record<string, string> = {
    'claude-opus-4.6': 'Opus (deep thinking)',
    'claude-opus-4-6': 'Opus (deep thinking)',
    'claude-sonnet-4-5': 'Sonnet 4.5 (fast)',
    'claude-sonnet-4-5': 'Sonnet (fast)',
    'claude-sonnet-4.5': 'Sonnet (fast)',
    'claude-sonnet-4-5-20250514': 'Sonnet (fast)',
    'gpt-4o-mini': 'GPT-4o Mini (speed)',
  };
  return modelNames[name] || name;
}

/** Humanize completed job label (same logic as ActiveJob) */
function humanizeCompletedLabel(job: CompletedJob): string {
  const raw = job.label || job.displayName || job.key || 'Task';

  if (raw.startsWith('Cron: ') || job.kind === 'cron') {
    const slug = raw.replace(/^Cron:\s*/, '');
    const cronNames: Record<string, string> = {
      'voice-pipeline-healthcheck': 'Voice system health check',
      'pre-release-health-monitor': 'Release readiness check',
      'voice-pipeline-health': 'Voice system health check',
      'desktop-icon-overhaul': 'Desktop icon redesign',
      'desktop-icon-overhaul-swarm-v2': 'Desktop icon redesign',
    };
    for (const [key, label] of Object.entries(cronNames)) {
      if (slug.includes(key)) return label;
    }
    return slug
      .replace(/-v\d+$/i, '')
      .replace(/-swarm(-v\d+)?$/i, '')
      .replace(/-/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  if (job.kind === 'subagent') {
    const cleaned = raw
      .replace(/^agent:main:subagent:/, '')
      .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Background task');

    const agentNames: Record<string, string> = {
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

    for (const [key, label] of Object.entries(agentNames)) {
      if (cleaned.includes(key)) return label;
    }

    return cleaned
      .replace(/-v\d+$/i, '')
      .replace(/-/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  return raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

/** Global stats panel showing technical details for all active jobs */
function StatsPanel({ jobs }: { jobs: ActiveJob[] }) {
  if (jobs.length === 0) return null;

  return (
    <div
      className="
        bg-[#0d0815]/90 backdrop-blur-md border border-white/5 rounded-xl
        p-3 max-h-[300px] overflow-y-auto
        shadow-xl shadow-black/50
      "
      style={{ minWidth: '280px', maxWidth: 'min(360px, calc(100vw - 40px))', fontFamily: 'Gohufont, monospace' }}
    >
      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 pb-1 border-b border-white/5">
        Technical Details
      </div>
      <div className="space-y-3">
        {jobs.map((job) => {
          const label = humanizeLabel(job);
          return (
            <div key={job.id} className="space-y-1 pb-2 border-b border-white/5 last:border-0 last:pb-0">
              <div className="text-xs text-white/70 font-medium mb-1">{label}</div>
              <div className="space-y-0.5 text-[11px] text-white/50">
                {job.model && (
                  <div><span className="text-white/30">Model:</span> {friendlyModel(job.model)}</div>
                )}
                {job.totalTokens > 0 && (
                  <div><span className="text-white/30">Tokens:</span> {job.totalTokens.toLocaleString()}</div>
                )}
                <div><span className="text-white/30">Started:</span> {new Date(job.startedAt).toLocaleTimeString()}</div>
                {job.channel && (
                  <div><span className="text-white/30">Source:</span> {job.channel === 'discord' ? 'Discord' : job.channel === 'webchat' ? 'Web chat' : job.channel}</div>
                )}
                <div><span className="text-white/30">Status:</span> {job.status}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

function CompletedJobCard({
  job,
  feedbackGiven,
  onThumbsUp,
  onThumbsDown,
}: {
  job: CompletedJob;
  feedbackGiven?: 'up' | 'down';
  onThumbsUp: (id: string, label: string) => void;
  onThumbsDown: (id: string, label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const label = humanizeCompletedLabel(job);

  return (
    <div
      className="
        transition-all duration-300 ease-out opacity-100 translate-x-0
      "
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div
        className="
          flex items-center gap-2 px-3 py-2 cursor-pointer select-none
          bg-[#1a1025]/60 backdrop-blur-md border border-white/10 rounded-xl
          hover:border-white/20 hover:bg-[#1a1025]/70
          transition-colors duration-200
          shadow-lg shadow-black/30
        "
        style={{ minWidth: '280px', maxWidth: 'min(360px, calc(100vw - 40px))' }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Completed checkmark indicator */}
        <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/70 font-medium truncate flex-1">{label}</span>
            <span className="text-[10px] text-white/30 flex-shrink-0">
              {formatTimeAgo(job.completedAt)}
            </span>
          </div>
          <span className="text-[10px] text-white/30 truncate">Completed</span>
        </div>

        <FeedbackButtons
          jobId={job.id}
          jobLabel={label}
          feedbackGiven={feedbackGiven}
          onThumbsUp={onThumbsUp}
          onThumbsDown={onThumbsDown}
        />

        <ExpandChevron expanded={expanded} />
      </div>

      {/* Expanded panel with summary/technical toggle */}
      <div
        className={`
          overflow-hidden transition-all duration-200 ease-out
          ${expanded ? 'max-h-[200px] mt-1' : 'max-h-0'}
        `}
      >
        <div
          className="
            relative bg-[#0d0815]/70 backdrop-blur-md border border-white/5 rounded-lg
            p-2.5 text-[11px] text-white/50 leading-relaxed
            max-h-[200px] overflow-y-auto
          "
          style={{ minWidth: '280px', maxWidth: 'min(360px, calc(100vw - 40px))', fontFamily: 'Gohufont, monospace' }}
        >
          {showTechnical ? (
            <div className="space-y-1 pr-7">
              <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Technical Details</div>
              {job.model && (
                <div><span className="text-white/25">Model:</span> {friendlyModel(job.model)}</div>
              )}
              {job.totalTokens > 0 && (
                <div><span className="text-white/25">Tokens:</span> {job.totalTokens.toLocaleString()}</div>
              )}
              <div><span className="text-white/25">Finished:</span> {new Date(job.completedAt).toLocaleTimeString()}</div>
              {job.channel && (
                <div><span className="text-white/25">Source:</span> {job.channel === 'discord' ? 'Discord' : job.channel === 'webchat' ? 'Web chat' : job.channel}</div>
              )}
            </div>
          ) : (
            <div className="pr-7 text-white/50">
              {generateHumanSummary(job)}
            </div>
          )}

          {/* Eye icon — bottom right */}
          <div className="absolute bottom-2 right-2" onClick={(e) => e.stopPropagation()}>
            <EyeToggleIcon
              active={showTechnical}
              onClick={(e) => { e.stopPropagation(); setShowTechnical((v) => !v); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Generate a human-friendly 2-sentence summary from a job */
function generateHumanSummary(job: ActiveJob | CompletedJob): string {
  const label = 'elapsedMs' in job ? humanizeLabel(job as ActiveJob) : humanizeCompletedLabel(job as CompletedJob);
  const desc = job.description || '';

  // If we have a good description that differs from the label, use it (but enhance it to 2 sentences)
  if (desc && desc.toLowerCase() !== label.toLowerCase()) {
    // If description is already 2+ sentences, return as-is
    if (desc.includes('. ') || desc.includes('? ') || desc.includes('! ')) {
      return desc;
    }
    // Otherwise, add context as a second sentence
    const modelInfo = job.model ? ` Using ${friendlyModel(job.model)}.` : '';
    const statusInfo = 'status' in job 
      ? job.status === 'complete' ? ' Task completed successfully.' : ' Currently in progress.'
      : '';
    return `${desc}.${modelInfo || statusInfo}`;
  }

  // Generate detailed 2-sentence summaries from the humanized label
  const lbl = label.toLowerCase();
  const modelInfo = job.model ? ` Using ${friendlyModel(job.model)}.` : '';
  const isComplete = 'status' in job && job.status === 'complete';

  // Common patterns → friendly 2-sentence summaries
  if (lbl.includes('health check') || lbl.includes('healthcheck')) {
    const what = lbl.includes('voice') ? 'voice system' : lbl.includes('release') ? 'release readiness' : 'system';
    return `Running a quick check to make sure the ${what} is working properly. This helps catch issues before they affect users.${modelInfo}`;
  }
  
  if (lbl.includes('voice') && lbl.includes('fix')) {
    return `Working on fixing an issue with the voice system. This should improve audio quality and response time.${modelInfo}`;
  }
  
  if (lbl.includes('voice') && lbl.includes('pipeline')) {
    return `Checking on the voice processing pipeline to ensure smooth audio handling. This monitors latency, quality, and error rates.${modelInfo}`;
  }
  
  if (lbl.includes('redesign') || lbl.includes('overhaul')) {
    const target = lbl.replace(/redesign(ing)?|overhaul(ing)?/gi, '').trim();
    return `Redesigning ${target || 'the interface'} to look better and work more smoothly. This includes visual polish and usability improvements.${modelInfo}`;
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
    return `Analyzing ${target} to understand what's happening. This helps identify patterns and potential improvements.${modelInfo}`;
  }
  
  if (lbl.includes('check') || lbl.includes('verify')) {
    const target = lbl.replace(/check(ing)?|verify(ing)?/gi, '').trim() || 'system components';
    return `Checking ${target} to ensure everything is working as expected. This is part of routine maintenance.${modelInfo}`;
  }
  
  if (lbl.includes('generat') || lbl.includes('creating')) {
    const target = lbl.replace(/generat(ing|e)?|creating?/gi, '').trim() || 'content';
    return `Generating ${target} based on your request. This may take a moment depending on complexity.${modelInfo}`;
  }

  if (lbl.includes('test')) {
    const target = lbl.replace(/test(ing)?/gi, '').trim() || 'components';
    return `Testing ${target} to make sure everything works correctly. This helps prevent bugs from reaching production.${modelInfo}`;
  }

  // Fallback: use the label with detailed context
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

function StopButton({ jobId, jobLabel, onStopping }: { jobId: string; jobLabel: string; onStopping?: () => void }) {
  const [stopping, setStopping] = useState(false);

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (stopping) return;
    
    setStopping(true);
    onStopping?.();
    
    try {
      // Use bot control base URL (proxied through Next.js API route)
      const botControlUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';
      const response = await fetch(`${botControlUrl}/api/tasks/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_label: jobLabel,
          action: 'stop'
        })
      });
      
      const result = await response.json();
      
      if (response.ok && result.status === 'stopped') {
        // Success - job will disappear when useActiveJobs detects it's gone
        console.log(`[ActiveJobs] Stopped task: ${jobLabel}`);
      } else {
        console.warn(`[ActiveJobs] Failed to stop task: ${result.message || 'unknown error'}`);
        setStopping(false);
      }
    } catch (error) {
      console.error(`[ActiveJobs] Error stopping task:`, error);
      setStopping(false);
    }
  };

  return (
    <button
      onClick={handleStop}
      disabled={stopping}
      className="
        group flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0
        text-white/30 hover:text-red-400 
        hover:bg-red-400/10 hover:shadow-[0_0_8px_rgba(248,113,113,0.15)]
        active:scale-90 active:bg-red-400/20
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-white/30
        transition-all duration-200 ease-out
      "
      title={stopping ? 'Stopping...' : 'Stop this task'}
      aria-label={stopping ? 'Stopping' : 'Stop task'}
    >
      {stopping ? (
        <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      ) : (
        <svg className="w-4 h-4 transition-transform duration-200 group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
    </button>
  );
}

function JobCard({ job, feedbackGiven, onThumbsUp, onThumbsDown }: {
  job: ActiveJob;
  feedbackGiven?: 'up' | 'down';
  onThumbsUp?: (id: string, label: string) => void;
  onThumbsDown?: (id: string, label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(job.elapsedMs);
  const [stopping, setStopping] = useState(false);

  // Live elapsed timer
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

  const label = humanizeLabel(job);
  const statusText = humanizeSubtitle(job);

  return (
    <div
      className={`
        transition-all duration-300 ease-out
        ${job.fadingOut ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'}
      `}
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div
        className="
          flex items-center gap-2 px-3 py-2 cursor-pointer select-none
          bg-[#1a1025]/80 backdrop-blur-md border border-white/10 rounded-xl
          hover:border-white/20 hover:bg-[#1a1025]/90
          transition-colors duration-200
          shadow-lg shadow-black/30
        "
        style={{ minWidth: '280px', maxWidth: 'min(360px, calc(100vw - 40px))' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <StatusIndicator status={job.status} />

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/90 font-medium truncate flex-1">{label}</span>
            <span className="text-[10px] text-white/40 flex-shrink-0">
              {formatElapsed(elapsedMs)}
            </span>
          </div>
          <span className="text-[10px] text-white/40 truncate">{statusText}</span>
        </div>

        {/* Stop button for running jobs */}
        {job.status === 'running' && !stopping && (
          <StopButton
            jobId={job.id}
            jobLabel={label}
            onStopping={() => setStopping(true)}
          />
        )}

        {/* Thumbs up/down for completed jobs */}
        {(job.status === 'complete' || job.fadingOut) && onThumbsUp && onThumbsDown && (
          <FeedbackButtons
            jobId={job.id}
            jobLabel={label}
            feedbackGiven={feedbackGiven}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
          />
        )}

        <ExpandChevron expanded={expanded} />
      </div>

      {/* Expanded panel with summary/technical toggle */}
      <div
        className={`
          overflow-hidden transition-all duration-200 ease-out
          ${expanded ? 'max-h-[200px] mt-1' : 'max-h-0'}
        `}
      >
        <div
          className="
            relative bg-[#0d0815]/70 backdrop-blur-md border border-white/5 rounded-lg
            p-2.5 text-[11px] text-white/50 leading-relaxed
            max-h-[200px] overflow-y-auto
          "
          style={{ minWidth: '280px', maxWidth: 'min(360px, calc(100vw - 40px))', fontFamily: 'Gohufont, monospace' }}
        >
          {showTechnical ? (
            <div className="space-y-1 pr-7">
              <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Technical Details</div>
              {job.model && (
                <div><span className="text-white/25">Model:</span> {friendlyModel(job.model)}</div>
              )}
              {job.totalTokens > 0 && (
                <div><span className="text-white/25">Tokens:</span> {job.totalTokens.toLocaleString()}</div>
              )}
              <div><span className="text-white/25">Started:</span> {new Date(job.startedAt).toLocaleTimeString()}</div>
              {job.channel && (
                <div><span className="text-white/25">Source:</span> {job.channel === 'discord' ? 'Discord' : job.channel === 'webchat' ? 'Web chat' : job.channel}</div>
              )}
              <div><span className="text-white/25">Status:</span> {job.status}</div>
            </div>
          ) : (
            <div className="pr-7 text-white/50">
              {generateHumanSummary(job)}
            </div>
          )}

          {/* Eye icon — bottom right */}
          <div className="absolute bottom-2 right-2" onClick={(e) => e.stopPropagation()}>
            <EyeToggleIcon
              active={showTechnical}
              onClick={(e) => { e.stopPropagation(); setShowTechnical((v) => !v); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tasks icon toggle button shown on mobile (left side) */
function GearToggleButton({
  count,
  hasRunning,
  hasFailed,
  expanded,
  onClick,
}: {
  count: number;
  hasRunning: boolean;
  hasFailed: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const accentColor = hasFailed
    ? 'border-red-400/40 text-red-300'
    : hasRunning
    ? 'border-blue-400/40 text-blue-200'
    : 'border-white/20 text-white/70';

  return (
    <button
      onClick={onClick}
      aria-label={`${count} active job${count !== 1 ? 's' : ''} — tap to ${expanded ? 'collapse' : 'expand'}`}
      className={`
        flex items-center gap-1.5 px-2.5 py-2 rounded-xl
        bg-[#1a1025]/80 backdrop-blur-md border
        shadow-lg shadow-black/40
        hover:border-white/30 hover:bg-[#1a1025]/90
        active:scale-95
        transition-all duration-200
        select-none cursor-pointer
        ${accentColor}
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

      {/* Tasks/list icon (not gear — avoids confusion with Settings button) */}
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

      {/* Count badge */}
      <span className="text-xs font-medium leading-none">{count}</span>

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

export function ActiveJobsWidget() {
  const { jobs, completedHistory } = useActiveJobs();
  const { effectiveIsMobile } = useLayoutMode();
  // Use context's effectiveIsMobile: respects both actual viewport and forced desktop/mobile override
  const isMobile = effectiveIsMobile;
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [desktopExpanded, setDesktopExpanded] = useState(true);
  // statsOpen removed — technical details now per-card via eye icon
  const { currentMode } = useDesktopMode();
  const {
    feedbackState,
    modalOpen,
    modalTaskId,
    modalTaskName,
    submitting,
    handleThumbsUp,
    openFeedbackModal,
    closeFeedbackModal,
    submitFeedback,
  } = useTaskFeedback();
  // Auto-collapse task list when desktop mode changes (e.g. tapping Monitor button)
  useEffect(() => {
    setMobileExpanded(false);
  }, [currentMode]);
  const containerRef = useRef<HTMLDivElement>(null);
  const desktopContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureGohufont();
  }, []);

  // Only show jobs that have meaningful labels
  const visibleJobs = jobs.filter(
    (j) => j.status === 'running' || j.status === 'failed' || j.fadingOut || j.label
  );

  // Track whether there are any active jobs (running, failed, or fading out)
  const hasActiveJobs = visibleJobs.length > 0;

  // Jobs list stays expanded/collapsed based on user action or mode change only

  const hasRunning = visibleJobs.some((j) => j.status === 'running');
  const hasFailed = visibleJobs.some((j) => j.status === 'failed');
  const allComplete = visibleJobs.every((j) => j.status === 'complete' || j.fadingOut);

  // Get latest job title for collapsed preview
  const latestJob = visibleJobs[0];
  const latestJobTitle = latestJob ? humanizeLabel(latestJob) : '';
  
  // Get latest completed job title for when no active jobs
  const latestCompletedJob = completedHistory[0];
  const latestCompletedJobTitle = latestCompletedJob ? humanizeCompletedLabel(latestCompletedJob) : '';

  const feedbackModal = (
    <TaskFeedbackModal
      taskId={modalTaskId || ''}
      taskName={modalTaskName}
      isOpen={modalOpen}
      onClose={closeFeedbackModal}
      onSubmit={submitFeedback}
      submitting={submitting}
    />
  );

  // ── Desktop: collapsible job cards, top-right ─────────────────────────────
  if (!isMobile) {
    // Collapsed state: compact pill widget (always visible)
    if (!desktopExpanded) {
      return (
        <div
          ref={desktopContainerRef}
          className="fixed top-[24px] right-4 z-[800]"
          style={{ pointerEvents: 'auto' }}
        >
          <button
            onClick={() => setDesktopExpanded(true)}
            className={`
              flex flex-col gap-0.5 px-3 py-2 rounded-xl
              bg-[#1a1025]/80 backdrop-blur-md border
              shadow-lg shadow-black/40
              hover:border-white/30 hover:bg-[#1a1025]/90
              active:scale-95
              transition-all duration-200
              select-none cursor-pointer
              ${hasActiveJobs 
                ? (hasFailed ? 'border-red-400/40' : hasRunning ? 'border-blue-400/40' : 'border-white/20')
                : 'border-white/10 opacity-70 hover:opacity-100'
              }
            `}
            style={{ fontFamily: 'Gohufont, monospace', maxWidth: '180px' }}
            aria-label={hasActiveJobs 
              ? `${visibleJobs.length} active job${visibleJobs.length !== 1 ? 's' : ''} — click to expand`
              : 'No active jobs — click to see recent history'
            }
          >
            {/* Row 1: indicator + count */}
            <div className="flex items-center gap-1.5">
              {/* Spinning ring when running, checkmark when all done or no active jobs, red dot on failure */}
              {hasActiveJobs ? (
                <>
                  {hasFailed ? (
                    <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  ) : hasRunning ? (
                    <div className="relative w-4 h-4 flex-shrink-0">
                      <div
                        className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"
                        style={{ animationDuration: '1.5s' }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                      </div>
                    </div>
                  ) : allComplete ? (
                    <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                      <div className="w-2 h-2 bg-yellow-400/60 rounded-full" />
                    </div>
                  )}
                  <span className={`text-xs font-medium leading-none ${hasFailed ? 'text-red-300' : hasRunning ? 'text-blue-200' : 'text-white/70'}`}>
                    {visibleJobs.length} {visibleJobs.length === 1 ? 'job' : 'jobs'}
                  </span>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium leading-none text-white/50">
                    no jobs
                  </span>
                </>
              )}
            </div>
            {/* Row 2: truncated latest job title */}
            {hasActiveJobs && latestJobTitle ? (
              <span className="text-[10px] text-white/40 truncate w-full text-left leading-tight">
                {latestJobTitle.length > 22 ? latestJobTitle.slice(0, 20) + '…' : latestJobTitle}
              </span>
            ) : !hasActiveJobs && latestCompletedJobTitle ? (
              <span className="text-[10px] text-white/30 truncate w-full text-left leading-tight">
                Last: {latestCompletedJobTitle.length > 16 ? latestCompletedJobTitle.slice(0, 14) + '…' : latestCompletedJobTitle}
              </span>
            ) : null}
          </button>
          {feedbackModal}
        </div>
      );
    }

    // Expanded state: full job cards with minimize button + stats toggle
    return (
      <div
        ref={desktopContainerRef}
        className="fixed top-[24px] right-4 z-[800] flex flex-col gap-2"
        style={{ pointerEvents: 'auto' }}
      >
        {/* Minimize button */}
        <div className="flex items-center self-end">
          <button
            onClick={() => setDesktopExpanded(false)}
            className="
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
              bg-[#1a1025]/80 backdrop-blur-md border border-white/10
              text-white/50 text-[11px] hover:text-white/70 hover:border-white/20
              active:scale-95 transition-all duration-200 select-none cursor-pointer
            "
            style={{ fontFamily: 'Gohufont, monospace' }}
            aria-label="Minimize jobs list"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
            </svg>
            <span>minimize</span>
          </button>
        </div>

        {/* Active job cards */}
        {hasActiveJobs && visibleJobs.map((job) => (
          <JobCard key={job.id} job={job} feedbackGiven={feedbackState.submitted.get(job.id)} onThumbsUp={handleThumbsUp} onThumbsDown={openFeedbackModal} />
        ))}
        
        {/* Show completed jobs history when no active jobs */}
        {!hasActiveJobs && completedHistory.length > 0 && (
          <>
            <div className="text-[10px] text-white/40 px-2 py-1 uppercase tracking-wider" style={{ fontFamily: 'Gohufont, monospace' }}>
              Recent completed jobs
            </div>
            {completedHistory.map((job) => (
              <CompletedJobCard key={job.id} job={job} feedbackGiven={feedbackState.submitted.get(job.id)} onThumbsUp={handleThumbsUp} onThumbsDown={openFeedbackModal} />
            ))}
          </>
        )}
        
        {/* Message when no jobs at all */}
        {!hasActiveJobs && completedHistory.length === 0 && (
          <div 
            className="px-3 py-2 text-[11px] text-white/40 italic"
            style={{ fontFamily: 'Gohufont, monospace' }}
          >
            No jobs yet. Activity will appear here.
          </div>
        )}
        {feedbackModal}
      </div>
    );
  }

  // ── Mobile: gear button (RIGHT) → expanded panel ────────────────────────────
  return (
    <div
      ref={containerRef}
      className="fixed top-[24px] right-4 z-[800] flex flex-col items-end gap-2"
      style={{ pointerEvents: 'none' }}
    >
      {/* Gear toggle button — always visible on mobile, tapping toggles the panel */}
      <div style={{ pointerEvents: 'auto' }}>
        <GearToggleButton
          count={visibleJobs.length}
          hasRunning={hasRunning}
          hasFailed={hasFailed}
          expanded={mobileExpanded}
          onClick={() => setMobileExpanded((v) => !v)}
        />
      </div>

      {/* Expanded job cards — slide down from the right */}
      <div
        className={`
          flex flex-col gap-1.5 pt-1
          transition-all duration-300 ease-out origin-top-right
          ${mobileExpanded
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-95 pointer-events-none'}
        `}
        style={{
          pointerEvents: mobileExpanded ? 'auto' : 'none',
          // Leave ~200px clear at bottom so Pearl + chat bar are never covered
          maxHeight: mobileExpanded ? 'calc(100dvh - 200px)' : '0px',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          transition: 'opacity 0.3s ease-out, transform 0.3s ease-out, max-height 0.3s ease-out',
        }}
      >
        {/* Minimize button */}
        <div className="flex items-center self-end">
          <button
            onClick={() => setMobileExpanded(false)}
            className="
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
              bg-[#1a1025]/80 backdrop-blur-md border border-white/10
              text-white/50 text-[11px] hover:text-white/70 hover:border-white/20
              active:scale-95 transition-all duration-200 select-none cursor-pointer
            "
            style={{ fontFamily: 'Gohufont, monospace' }}
            aria-label="Minimize jobs list"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>minimize</span>
          </button>
        </div>

        {/* Active job cards */}
        {hasActiveJobs && visibleJobs.map((job) => (
          <JobCard key={job.id} job={job} feedbackGiven={feedbackState.submitted.get(job.id)} onThumbsUp={handleThumbsUp} onThumbsDown={openFeedbackModal} />
        ))}
        
        {/* Show completed jobs history when no active jobs */}
        {!hasActiveJobs && completedHistory.length > 0 && (
          <>
            <div className="text-[10px] text-white/40 px-2 py-1 uppercase tracking-wider" style={{ fontFamily: 'Gohufont, monospace' }}>
              Recent completed jobs
            </div>
            {completedHistory.map((job) => (
              <CompletedJobCard key={job.id} job={job} feedbackGiven={feedbackState.submitted.get(job.id)} onThumbsUp={handleThumbsUp} onThumbsDown={openFeedbackModal} />
            ))}
          </>
        )}
        
        {/* Message when no jobs at all */}
        {!hasActiveJobs && completedHistory.length === 0 && (
          <div 
            className="px-3 py-2 text-[11px] text-white/40 italic"
            style={{ fontFamily: 'Gohufont, monospace' }}
          >
            No jobs yet. Activity will appear here.
          </div>
        )}
      </div>
      {feedbackModal}
    </div>
  );
}
