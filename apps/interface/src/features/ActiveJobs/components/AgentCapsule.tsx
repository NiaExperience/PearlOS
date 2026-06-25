import React, { useState } from 'react';
import { AgencyAgentSprite } from './AgencyAssets';

export type AgentVariant =
  | 'codex'
  | 'opus'
  | 'sonnet'
  | 'claude'
  | 'gemma'
  | 'qwen'
  | 'pearl'
  | 'design'
  | 'code'
  | 'art'
  | 'qa';

interface AgentCapsuleProps {
  agentName: string;
  thought?: string;
  variant?: AgentVariant;
  isExpandable?: boolean;
  estimatedMinutes?: number;
  className?: string;
}

const variantStyles: Record<AgentVariant, { bg: string; text: string; dot: string; border: string; glow: string }> = {
  codex:   { bg: 'bg-[#3B82F6]/15',  text: 'text-[#60A5FA]', dot: 'bg-[#3B82F6]', border: 'border-[#3B82F6]/25',  glow: 'shadow-[0_0_8px_rgba(59,130,246,0.15)]' },
  opus:    { bg: 'bg-[#A855F7]/15',  text: 'text-[#C084FC]', dot: 'bg-[#A855F7]', border: 'border-[#A855F7]/25',  glow: 'shadow-[0_0_8px_rgba(168,85,247,0.15)]' },
  sonnet:  { bg: 'bg-[#14B8A6]/15',  text: 'text-[#2DD4BF]', dot: 'bg-[#14B8A6]', border: 'border-[#14B8A6]/25',  glow: 'shadow-[0_0_8px_rgba(20,184,166,0.15)]' },
  claude:  { bg: 'bg-[#F97316]/15',  text: 'text-[#FB923C]', dot: 'bg-[#F97316]', border: 'border-[#F97316]/25',  glow: 'shadow-[0_0_8px_rgba(249,115,22,0.15)]' },
  gemma:   { bg: 'bg-[#EC4899]/15',  text: 'text-[#F472B6]', dot: 'bg-[#EC4899]', border: 'border-[#EC4899]/25',  glow: 'shadow-[0_0_8px_rgba(236,72,153,0.15)]' },
  qwen:    { bg: 'bg-[#06B6D4]/15',  text: 'text-[#22D3EE]', dot: 'bg-[#06B6D4]', border: 'border-[#06B6D4]/25',  glow: 'shadow-[0_0_8px_rgba(6,182,212,0.15)]' },
  pearl:   { bg: 'bg-[#FFD233]/15',  text: 'text-[#FDE047]', dot: 'bg-[#FFD233]', border: 'border-[#FFD233]/25',  glow: 'shadow-[0_0_8px_rgba(255,210,51,0.15)]' },
  design:  { bg: 'bg-[#8B5CF6]/15',  text: 'text-[#A78BFA]', dot: 'bg-[#8B5CF6]', border: 'border-[#8B5CF6]/25',  glow: 'shadow-[0_0_8px_rgba(139,92,246,0.15)]' },
  code:    { bg: 'bg-[#10B981]/15',  text: 'text-[#34D399]', dot: 'bg-[#10B981]', border: 'border-[#10B981]/25',  glow: 'shadow-[0_0_8px_rgba(16,185,129,0.15)]' },
  art:     { bg: 'bg-[#F43F5E]/15',  text: 'text-[#FB7185]', dot: 'bg-[#F43F5E]', border: 'border-[#F43F5E]/25',  glow: 'shadow-[0_0_8px_rgba(244,63,94,0.15)]' },
  qa:      { bg: 'bg-[#F59E0B]/15',  text: 'text-[#FBBF24]', dot: 'bg-[#F59E0B]', border: 'border-[#F59E0B]/25',  glow: 'shadow-[0_0_8px_rgba(245,158,11,0.15)]' },
};

function resolveVariant(agentName: string): AgentVariant {
  const lower = agentName.toLowerCase();
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('gemma')) return 'gemma';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('pearl')) return 'pearl';
  if (lower.includes('design')) return 'design';
  if (lower.includes('art')) return 'art';
  if (lower.includes('qa') || lower.includes('test')) return 'qa';
  return 'code';
}

function friendlyAgentName(agentName: string): string {
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

export function AgentCapsule({
  agentName,
  thought,
  variant,
  isExpandable = false,
  estimatedMinutes,
  className = '',
}: AgentCapsuleProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const resolvedVariant = variant || resolveVariant(agentName);
  const styles = variantStyles[resolvedVariant];
  const displayName = friendlyAgentName(agentName);
  const displayThought = thought || `${displayName} is working…`;
  const timeHint = estimatedMinutes && estimatedMinutes > 0
    ? `~${estimatedMinutes}m`
    : null;

  const content = (
    <div
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        ${styles.bg} ${styles.text} border ${styles.border} ${styles.glow}
        text-[10px] font-medium tracking-wide
        backdrop-blur-sm
        transition-all duration-200
        ${className}
      `}
      title={displayThought}
    >
      <AgencyAgentSprite agentName={agentName} />
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dot} ${resolvedVariant !== 'pearl' ? 'animate-pulse' : ''}`} />
      <span className="truncate max-w-[120px]">{displayName}</span>
      {timeHint && (
        <span className="text-white/40 text-[9px]">{timeHint}</span>
      )}
    </div>
  );

  if (!isExpandable) return content;

  return (
    <button
      onClick={() => setIsExpanded(!isExpanded)}
      aria-expanded={isExpanded}
      className="inline-block text-left"
    >
      {content}
    </button>
  );
}

/** Expanded capsule that shows the full thought text */
export function AgentCapsuleExpanded({
  agentName,
  thought,
  variant,
  estimatedMinutes,
  className = '',
}: AgentCapsuleProps) {
  const resolvedVariant = variant || resolveVariant(agentName);
  const styles = variantStyles[resolvedVariant];
  const displayName = friendlyAgentName(agentName);
  const displayThought = thought || `${displayName} is working…`;
  const timeHint = estimatedMinutes && estimatedMinutes > 0
    ? `~${estimatedMinutes}m estimated`
    : null;

  return (
    <div
      className={`
        flex items-start gap-2 px-3 py-2 rounded-xl
        ${styles.bg} ${styles.text} border ${styles.border}
        text-[11px] leading-relaxed
        backdrop-blur-sm
        transition-all duration-200
        ${className}
      `}
    >
      <AgencyAgentSprite agentName={agentName} className="mt-0.5" />
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{displayName}</span>
          {timeHint && (
            <span className="text-white/30 text-[9px]">{timeHint}</span>
          )}
        </div>
        <span className="text-white/70">{displayThought}</span>
      </div>
    </div>
  );
}
