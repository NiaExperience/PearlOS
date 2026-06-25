import React from 'react';

export const AGENCY_LOGO_SRC = '/agency-assets/agency-logo.png';

export type AgencyAgentRole =
  | 'agency'
  | 'code'
  | 'design'
  | 'research'
  | 'review'
  | 'architect';

const roleAccent: Record<AgencyAgentRole, string> = {
  agency: '#FFD233',
  code: '#60A5FA',
  design: '#C084FC',
  research: '#2DD4BF',
  review: '#FBBF24',
  architect: '#FB923C',
};

const roleLabel: Record<AgencyAgentRole, string> = {
  agency: 'Agency',
  code: 'Code',
  design: 'Design',
  research: 'Research',
  review: 'Review',
  architect: 'Plan',
};

export function resolveAgencyAgentRole(agentName: string): AgencyAgentRole {
  const lower = (agentName || '').toLowerCase();
  if (/\b(design|designer|creative|art)\b/.test(lower)) return 'design';
  if (/\b(research|researcher|analyst|investigator)\b/.test(lower)) return 'research';
  if (/\b(review|reviewer|qa|auditor|test)\b/.test(lower)) return 'review';
  if (/\b(architect|planner|plan)\b/.test(lower)) return 'architect';
  if (/\b(code|coder|codex|developer|engineer|claude)\b/.test(lower)) return 'code';
  return 'agency';
}

export function AgencyLogoMark({ className = '' }: { className?: string }) {
  return (
    <img
      src={AGENCY_LOGO_SRC}
      alt="The Agency"
      className={className}
      draggable={false}
    />
  );
}

export function AgencyAgentSprite({
  agentName,
  className = '',
}: {
  agentName: string;
  className?: string;
}) {
  const role = resolveAgencyAgentRole(agentName);
  const accent = roleAccent[role];

  return (
    <span
      className={`relative inline-flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border bg-[#100918] shadow-[0_0_10px_rgba(0,0,0,0.35)] ${className}`}
      style={{ borderColor: `${accent}66` }}
      aria-hidden="true"
    >
      <img
        src={AGENCY_LOGO_SRC}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-35"
        draggable={false}
      />
      <span
        className="relative text-[8px] font-bold leading-none"
        style={{ color: accent, textShadow: '0 1px 2px rgba(0,0,0,0.75)' }}
      >
        {roleLabel[role]}
      </span>
    </span>
  );
}
