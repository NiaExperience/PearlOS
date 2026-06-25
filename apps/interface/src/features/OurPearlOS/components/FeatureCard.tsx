"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import React from "react";

import type { DecoratedFeature } from "@interface/lib/our-pearlos-catalog";

import VoteButton from "./VoteButton";

interface FeatureCardProps {
  feature: DecoratedFeature;
  signedIn: boolean;
  voting: boolean;
  installing: boolean;
  onVote: (feature: DecoratedFeature) => void;
  installed: boolean;
  onInstall: (feature: DecoratedFeature) => void;
  onUninstall: (feature: DecoratedFeature) => void;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ feature, signedIn, voting, installing, onVote, installed, onInstall, onUninstall }) => (
  <article className="pearl-themed-app-panel flex items-start justify-between gap-3 rounded-md border p-3">
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{feature.title}</h4>
        {feature.category ? (
          <span className="pearl-themed-app-muted shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]">
            {feature.category}
          </span>
        ) : null}
      </div>
      <p className="pearl-themed-app-muted mt-1 text-[12px] leading-5">{feature.summary}</p>
    </div>
    {feature.votable || feature.status === "community" ? (
      <div className="flex shrink-0 flex-col items-end gap-2">
        <VoteButton feature={feature} signedIn={signedIn} voting={voting} onVote={onVote} />
        {feature.status === "community" ? (
          <button
            type="button"
            onClick={() => installed ? onUninstall(feature) : onInstall(feature)}
            disabled={installing}
            className="inline-flex h-8 min-w-[82px] items-center justify-center gap-1.5 rounded border px-2 text-[11px] font-semibold transition hover:opacity-90 disabled:cursor-default"
            style={{
              background: installed
                ? "color-mix(in srgb, var(--pearl-accent), transparent 78%)"
                : "var(--pearl-window-content-bg)",
              borderColor: installed
                ? "color-mix(in srgb, var(--pearl-accent), transparent 45%)"
                : "var(--pearl-window-border)",
              color: "var(--pearl-text)",
            }}
            aria-label={installed ? `Remove ${feature.title} from my PearlOS` : `Install ${feature.title} to my PearlOS`}
            title={installed ? "Remove from my PearlOS" : "Install to my PearlOS"}
          >
            {installing ? <Loader2 size={13} className="animate-spin" /> : installed ? <Trash2 size={13} /> : <Plus size={13} />}
            <span>{installed ? "Remove" : "Install"}</span>
          </button>
        ) : null}
      </div>
    ) : null}
  </article>
);

export default FeatureCard;
