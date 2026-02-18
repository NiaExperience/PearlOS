'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useActiveJobs, type ActiveJob } from '../hooks/useActiveJobs';

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
    };
    // Try exact match first, then prefix match
    for (const [key, label] of Object.entries(cronNames)) {
      if (slug.includes(key)) return label;
    }
    // Generic: convert kebab-case to sentence
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Sub-agents: clean up the label
  if (job.kind === 'subagent') {
    // Strip technical prefixes
    const cleaned = raw
      .replace(/^agent:main:subagent:/, '')
      .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-.*$/, 'Background task'); // UUID-only labels

    // Known sub-agent labels → friendly names
    const agentNames: Record<string, string> = {
      'widget-test': 'Widget test',
      'active-jobs-widget': 'Building jobs dashboard',
      'pipeline-timing': 'Analyzing voice latency',
      'fix-fast-voice': 'Fixing voice pipeline',
      'fix-duplicate-messages': 'Fixing duplicate messages',
      'fix-simple-silence': 'Fixing voice silence',
      'fix-canvas-leak': 'Fixing canvas leak',
      'canvas-zindex': 'Fixing avatar visibility',
      'context-audit': 'Optimizing response speed',
      'swarm-architecture': 'Designing voice architecture',
      'regression-analysis': 'Running regression analysis',
      'investigate-duplicates': 'Investigating duplicates',
      'mobile-widget-fix': 'Fixing mobile layout',
    };

    for (const [key, label] of Object.entries(agentNames)) {
      if (cleaned.includes(key)) return label;
    }

    // Generic: convert kebab-case to sentence case
    return cleaned.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  return raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Turn status + kind into a friendly one-liner */
function humanizeStatus(job: ActiveJob): string {
  if (job.status === 'running') {
    if (job.kind === 'cron') return 'Checking now...';
    return 'Working on it...';
  }
  if (job.status === 'complete') return 'Done';
  if (job.status === 'failed') return 'Something went wrong';
  // idle
  if (job.kind === 'cron') return 'Scheduled task';
  return 'Waiting';
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
    'claude-opus-4-6': 'Opus (deep thinking)',
    'claude-sonnet-4-5': 'Sonnet (fast)',
    'claude-sonnet-4-5-20250514': 'Sonnet (fast)',
    'gpt-4o-mini': 'GPT-4o Mini (speed)',
  };
  return modelNames[name] || name;
}

function JobCard({ job }: { job: ActiveJob }) {
  const [expanded, setExpanded] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(job.elapsedMs);
  const logRef = useRef<HTMLDivElement>(null);

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
  const statusText = humanizeStatus(job);

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
          max-w-[320px]
          shadow-lg shadow-black/30
        "
        onClick={() => setExpanded((e) => !e)}
      >
        <StatusIndicator status={job.status} />

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/90 font-medium truncate">{label}</span>
            <span className="text-[10px] text-white/40 flex-shrink-0">
              {formatElapsed(elapsedMs)}
            </span>
          </div>
          <span className="text-[10px] text-white/40 truncate">{statusText}</span>
        </div>

        <ExpandChevron expanded={expanded} />
      </div>

      {/* Expanded details area */}
      <div
        className={`
          overflow-hidden transition-all duration-200 ease-out
          ${expanded ? 'max-h-[200px] mt-1' : 'max-h-0'}
        `}
      >
        <div
          ref={logRef}
          className="
            bg-[#0d0815]/90 backdrop-blur-md border border-white/5 rounded-lg
            p-2.5 text-[11px] text-white/60 leading-relaxed
            max-h-[200px] overflow-y-auto
            max-w-[320px]
          "
          style={{ fontFamily: 'Gohufont, monospace' }}
        >
          <div className="space-y-1">
            {job.description ? (
              <div className="text-white/60 leading-snug">{job.description}</div>
            ) : job.kind === 'subagent' ? (
              <div className="text-white/50">🤖 Pearl is working on this in the background</div>
            ) : job.kind === 'cron' ? (
              <div className="text-white/50">⏰ Scheduled automatic task</div>
            ) : null}
            {job.model && (
              <div><span className="text-white/30">Using:</span> {friendlyModel(job.model)}</div>
            )}
            {job.totalTokens > 0 && (
              <div><span className="text-white/30">Progress:</span> {job.totalTokens.toLocaleString()} tokens processed</div>
            )}
            <div><span className="text-white/30">Started:</span> {new Date(job.startedAt).toLocaleTimeString()}</div>
            {job.channel && (
              <div><span className="text-white/30">Source:</span> {job.channel === 'discord' ? 'Discord' : job.channel}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small spinning pill shown on mobile when collapsed */
function MobilePill({
  count,
  hasRunning,
  hasFailed,
  onClick,
}: {
  count: number;
  hasRunning: boolean;
  hasFailed: boolean;
  onClick: () => void;
}) {
  const icon = hasFailed ? '⚠️' : hasRunning ? '⚡' : '✓';
  const spinnerColor = hasFailed
    ? 'border-red-400/30 border-t-red-400'
    : 'border-blue-400/30 border-t-blue-400';

  return (
    <button
      onClick={onClick}
      aria-label={`${count} active job${count !== 1 ? 's' : ''} — tap to expand`}
      className="
        flex items-center gap-1.5 px-3 py-2 rounded-full
        bg-[#1a1025]/80 backdrop-blur-md border border-white/10
        shadow-lg shadow-black/40
        hover:border-white/20 hover:bg-[#1a1025]/90
        active:scale-95
        transition-all duration-200
        select-none cursor-pointer
      "
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      {hasRunning && (
        <div className="relative w-4 h-4 flex-shrink-0">
          <div
            className={`w-4 h-4 border-2 rounded-full animate-spin ${spinnerColor}`}
            style={{ animationDuration: '1.5s' }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
          </div>
        </div>
      )}
      <span className="text-xs text-white/90 font-medium leading-none">
        {count} {icon}
      </span>
    </button>
  );
}

/** Hook that returns true when screen width is below the given breakpoint */
function useIsMobile(breakpoint = 768): boolean {
  // Initialize as false to match server render and avoid hydration mismatch
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}

export function ActiveJobsWidget() {
  const { jobs } = useActiveJobs();
  const isMobile = useIsMobile();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureGohufont();
  }, []);

  // Collapse when switching to desktop
  useEffect(() => {
    if (!isMobile) setMobileExpanded(false);
  }, [isMobile]);

  // Click-outside to collapse on mobile
  const handleClickOutside = useCallback((e: MouseEvent | TouchEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setMobileExpanded(false);
    }
  }, []);

  useEffect(() => {
    if (mobileExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [mobileExpanded, handleClickOutside]);

  // Only show jobs that have meaningful labels
  const visibleJobs = jobs.filter(
    (j) => j.status === 'running' || j.status === 'failed' || j.fadingOut || j.label
  );

  if (visibleJobs.length === 0) return null;

  const hasRunning = visibleJobs.some((j) => j.status === 'running');
  const hasFailed = visibleJobs.some((j) => j.status === 'failed');

  // ── Desktop: render exactly as before ──────────────────────────────────────
  if (!isMobile) {
    return (
      <div
        className="fixed top-[24px] right-4 z-[800] flex flex-col gap-2"
        style={{ pointerEvents: 'auto' }}
      >
        {visibleJobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    );
  }

  // ── Mobile: pill → expanded panel ─────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="fixed top-[72px] right-4 z-[800] flex flex-col items-end gap-2"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Pill is always visible on mobile — tapping toggles the panel */}
      <MobilePill
        count={visibleJobs.length}
        hasRunning={hasRunning}
        hasFailed={hasFailed}
        onClick={() => setMobileExpanded((v) => !v)}
      />

      {/* Expanded job cards — slide in from the right */}
      <div
        className={`
          flex flex-col gap-2 overflow-hidden
          transition-all duration-300 ease-out origin-top-right
          ${mobileExpanded
            ? 'opacity-100 scale-100 max-h-[70vh]'
            : 'opacity-0 scale-95 max-h-0 pointer-events-none'}
        `}
      >
        {/* Collapse button */}
        <button
          onClick={() => setMobileExpanded(false)}
          className="
            self-end flex items-center gap-1.5 px-2.5 py-1 rounded-lg
            bg-[#1a1025]/80 backdrop-blur-md border border-white/10
            text-[10px] text-white/50 hover:text-white/80
            transition-colors duration-150 cursor-pointer
          "
          style={{ fontFamily: 'Gohufont, monospace' }}
          aria-label="Collapse jobs panel"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          close
        </button>

        {/* Job cards */}
        {visibleJobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
