import React from 'react';

interface AgentEmojiBubbleProps {
  agentName: string;
  thought?: string;
  className?: string;
}

function emojiForAgent(agentName: string): string {
  const lower = (agentName || '').toLowerCase();
  if (lower.includes('codex')) return '🐬';
  if (lower.includes('gpt') || lower.includes('openai')) return '🦎';
  if (lower.includes('gemini')) return '🦊';
  if (/claude[-\s]?code/.test(lower)) return '🐙';
  if (lower.includes('opus') || lower.includes('claude')) return '🐙';
  if (lower.includes('kimi')) return '🐯';
  if (lower.includes('qwen')) return '🦉';
  if (lower.includes('gemma')) return '🐱';
  return '🐙';
}

function scrubLegacyFableNames(value: string): string {
  return String(value || '')
    .replace(/\banthropic\/claude[-_\s.]*opus[-_\w.]*/gi, 'Claude Opus 4.6')
    .replace(/\bclaude[-_\s.]*opus[-_\w.]*/gi, 'Claude Opus 4.6')
    .replace(/\bclaude\s+opus\b/gi, 'Claude Opus 4.6')
    .replace(/\bfable\s*5?\b/gi, 'Claude Opus 4.6')
    .replace(/\bopus\b/gi, 'Claude Opus 4.6');
}

function friendlyAgentLabel(agentName: string): string {
  const lower = (agentName || '').toLowerCase();
  if (lower.includes('codex')) return 'Codex';
  if (/claude[-\s]?code/.test(lower)) return 'Claude Code';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('opus') || lower.includes('fable') || lower.includes('claude')) return 'Claude Opus 4.6';
  if (lower.includes('gemini')) return 'Gemini';
  if (lower.includes('qwen')) return 'Qwen';
  if (lower.includes('gemma')) return 'Gemma';
  return scrubLegacyFableNames(agentName.split('/').pop() || agentName || 'agent');
}

// Role-to-action mapping. Bubbles describe what the agent is *doing*, not
// which model is doing it — "Writing code…" is meaningful to a user;
// "claude/sonnet-4-7" or "The Agency" is not. Spec roles: agency, code,
// design, research, review, architect. Anything we can't classify falls
// back to the agency verb so general-purpose models (claude/opus/sonnet/
// qwen/…) and the catch-all "agency" assignee both read as "Working…".
export function actionForAgent(agentName: string): string {
  const lower = (agentName || '').toLowerCase();
  if (/\b(design|designer|creative)\b/.test(lower)) return 'Designing…';
  if (/\b(research|researcher|analyst|investigator)\b/.test(lower)) return 'Researching…';
  if (/\b(review|reviewer|qa|auditor)\b/.test(lower)) return 'Reviewing…';
  if (/\b(architect|planner|plan)\b/.test(lower)) return 'Planning…';
  if (/\b(code|coder|codex|developer|engineer)\b/.test(lower)) return 'Writing code…';
  if (/\b(agency|the[ _-]?agency)\b/.test(lower)) return 'Working…';
  return 'Working…';
}

function truncate(text: string, max: number): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

export function AgentEmojiBubble({
  agentName,
  thought,
  className = '',
}: AgentEmojiBubbleProps) {
  const emoji = emojiForAgent(agentName);
  const text = truncate(scrubLegacyFableNames(thought || actionForAgent(agentName)), 40);

  return (
    <div className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <span
        className="text-base leading-none flex-shrink-0"
        aria-label={friendlyAgentLabel(agentName)}
        role="img"
      >
        {emoji}
      </span>
      {text && (
        <span className="bg-white/95 text-black/80 text-[10px] leading-tight px-2 py-0.5 rounded-2xl truncate shadow-sm">
          {text}
        </span>
      )}
    </div>
  );
}
