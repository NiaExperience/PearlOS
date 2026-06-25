"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import type { DecoratedFeature } from "@interface/lib/our-pearlos-catalog";
import FeatureCard from "./FeatureCard";

interface FeatureSectionProps {
  title: string;
  Icon: LucideIcon;
  features: DecoratedFeature[];
  signedIn: boolean;
  votingId: string | null;
  installingId: string | null;
  onVote: (feature: DecoratedFeature) => void;
  installedFeatureIds: Record<string, true>;
  onInstall: (feature: DecoratedFeature) => void;
  onUninstall: (feature: DecoratedFeature) => void;
  emptyLabel: string;
}

const FeatureSection: React.FC<FeatureSectionProps> = ({
  title,
  Icon,
  features,
  signedIn,
  votingId,
  installingId,
  onVote,
  installedFeatureIds,
  onInstall,
  onUninstall,
  emptyLabel,
}) => (
  <section className="grid gap-2">
    <div className="pearl-themed-app-muted flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
      <Icon size={14} />
      <span>{title}</span>
      <span aria-hidden className="opacity-70">· {features.length}</span>
    </div>
    {features.length === 0 ? (
      <p className="pearl-themed-app-panel rounded-md border px-3 py-4 text-center text-[12px] opacity-70">
        {emptyLabel}
      </p>
    ) : (
      <div className="grid gap-2">
        {features.map((feature) => (
          <FeatureCard
            key={feature.id}
            feature={feature}
            signedIn={signedIn}
            voting={votingId === feature.id}
            installing={installingId === feature.id}
            onVote={onVote}
            installed={installedFeatureIds[feature.id] === true}
            onInstall={onInstall}
            onUninstall={onUninstall}
          />
        ))}
      </div>
    )}
  </section>
);

export default FeatureSection;
