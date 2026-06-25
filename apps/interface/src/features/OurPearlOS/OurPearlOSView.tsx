"use client";

import React from "react";
import { AlertCircle, Hammer, Loader2, Sparkles, Users } from "lucide-react";
import { useOurPearlOSData } from "./useOurPearlOSData";
import CommunityForumPanel from "./components/CommunityForumPanel";
import FeatureSection from "./components/FeatureSection";

const OurPearlOSView: React.FC = () => {
  const { catalog, signedIn, loading, error, votingId, installingId, installedFeatureIds, vote, installFeature, uninstallFeature } = useOurPearlOSData();

  return (
    <main className="pearl-themed-app flex h-full min-h-0 flex-col overflow-hidden">
      <header className="pearl-themed-app-surface flex flex-shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="pearl-themed-app-muted flex items-center gap-2 text-[11px] uppercase tracking-[0.1em]">
            <Sparkles size={14} />
            Our PearlOS
          </div>
          <h2 className="mt-0.5 truncate text-base font-semibold leading-tight">
            Features the community is building
          </h2>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded border border-red-400/25 bg-red-950/30 px-3 py-2 text-[11px] text-red-100">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {!signedIn && !loading ? (
        <p className="pearl-themed-app-muted mx-4 mt-3 rounded border px-3 py-2 text-[11px]">
          Sign in to vote on community features and post in the forum.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {loading && !catalog ? (
          <div className="pearl-themed-app-muted flex h-40 items-center justify-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" />
            Loading features…
          </div>
        ) : catalog ? (
          <div className="grid gap-5">
            <CommunityForumPanel />
            <FeatureSection
              title="Latest public features"
              Icon={Sparkles}
              features={catalog.public}
              signedIn={signedIn}
              votingId={votingId}
              installingId={installingId}
              onVote={vote}
              installedFeatureIds={installedFeatureIds}
              onInstall={installFeature}
              onUninstall={uninstallFeature}
              emptyLabel="No public features yet."
            />
            <FeatureSection
              title="Integrating next build"
              Icon={Hammer}
              features={catalog.integrating}
              signedIn={signedIn}
              votingId={votingId}
              installingId={installingId}
              onVote={vote}
              installedFeatureIds={installedFeatureIds}
              onInstall={installFeature}
              onUninstall={uninstallFeature}
              emptyLabel="Nothing queued for the next build."
            />
            <FeatureSection
              title="Community features — vote and add"
              Icon={Users}
              features={catalog.community}
              signedIn={signedIn}
              votingId={votingId}
              installingId={installingId}
              onVote={vote}
              installedFeatureIds={installedFeatureIds}
              onInstall={installFeature}
              onUninstall={uninstallFeature}
              emptyLabel="No community features to vote on yet."
            />
          </div>
        ) : null}
      </div>
    </main>
  );
};

export default OurPearlOSView;
