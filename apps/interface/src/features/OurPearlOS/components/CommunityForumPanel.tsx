"use client";

import React from "react";
import { AlertCircle, Loader2, MessageCircle } from "lucide-react";
import { useOurPearlOSForum } from "../useOurPearlOSForum";
import ForumComposer from "./ForumComposer";
import ForumThreadView from "./ForumThreadView";
import ForumTopicList from "./ForumTopicList";

const CommunityForumPanel: React.FC = () => {
  const {
    topics,
    selectedTopic,
    selectedTopicId,
    signedIn,
    viewerLabel,
    loading,
    posting,
    error,
    setSelectedTopicId,
    createTopic,
    replyToTopic,
  } = useOurPearlOSForum();

  return (
    <section className="grid gap-3">
      <div className="pearl-themed-app-muted flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
        <span className="inline-flex items-center gap-2">
          <MessageCircle size={14} />
          Community forum
        </span>
        {viewerLabel ? <span className="normal-case tracking-normal">Posting as - {viewerLabel}</span> : null}
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded border border-red-400/25 bg-red-950/30 px-3 py-2 text-[11px] text-red-100">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {!signedIn && !loading ? (
        <p className="pearl-themed-app-muted rounded border px-3 py-2 text-[11px]">
          Sign in to start topics and reply.
        </p>
      ) : null}

      {loading ? (
        <div className="pearl-themed-app-muted flex h-28 items-center justify-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading forum…
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.45fr)]">
          <div className="grid content-start gap-3">
            <ForumComposer mode="topic" signedIn={signedIn} posting={posting} onSubmit={createTopic} />
            <ForumTopicList topics={topics} selectedTopicId={selectedTopicId} onSelect={setSelectedTopicId} />
          </div>
          <ForumThreadView
            topic={selectedTopic}
            signedIn={signedIn}
            posting={posting}
            onReply={replyToTopic}
          />
        </div>
      )}
    </section>
  );
};

export default CommunityForumPanel;
