"use client";

import React from "react";
import { Loader2, ThumbsUp } from "lucide-react";
import type { DecoratedFeature } from "@interface/lib/our-pearlos-catalog";

interface VoteButtonProps {
  feature: DecoratedFeature;
  signedIn: boolean;
  voting: boolean;
  onVote: (feature: DecoratedFeature) => void;
}

const VoteButton: React.FC<VoteButtonProps> = ({ feature, signedIn, voting, onVote }) => {
  const disabled = voting || !signedIn;
  const label = feature.hasVoted ? `Remove your vote for ${feature.title}` : `Vote for ${feature.title}`;

  return (
    <button
      type="button"
      onClick={() => onVote(feature)}
      disabled={disabled}
      aria-pressed={feature.hasVoted}
      aria-label={label}
      title={signedIn ? label : "Sign in to vote"}
      className="inline-flex h-8 min-w-[58px] items-center justify-center gap-1.5 rounded border px-2 text-xs font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: feature.hasVoted
          ? "color-mix(in srgb, var(--pearl-accent), transparent 74%)"
          : "var(--pearl-window-content-bg)",
        borderColor: feature.hasVoted
          ? "color-mix(in srgb, var(--pearl-accent), transparent 46%)"
          : "var(--pearl-window-border)",
        color: "var(--pearl-text)",
      }}
    >
      {voting ? <Loader2 size={14} className="animate-spin" /> : <ThumbsUp size={14} />}
      <span>{feature.voteCount}</span>
    </button>
  );
};

export default VoteButton;
