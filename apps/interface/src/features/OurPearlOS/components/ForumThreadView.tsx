"use client";

import React from "react";
import type { ForumReply, ForumTopic } from "@interface/lib/our-pearlos-forum-store";
import ForumComposer from "./ForumComposer";

interface ForumThreadViewProps {
  topic: ForumTopic | null;
  signedIn: boolean;
  posting: boolean;
  onReply: (topicId: string, body: string) => Promise<boolean>;
}

function stamp(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ForumPost: React.FC<{ body: string; authorLabel: string; createdAt: number; kind?: "topic" | "reply" }> = ({
  body,
  authorLabel,
  createdAt,
  kind = "reply",
}) => (
  <article className={kind === "topic" ? "grid gap-2" : "rounded-md border p-3"} style={{ borderColor: "var(--pearl-window-border)" }}>
    <p className="m-0 whitespace-pre-wrap text-sm leading-6">{body}</p>
    <div className="pearl-themed-app-muted flex items-center justify-between gap-3 text-[11px]">
      <span>- {authorLabel}</span>
      <time>{stamp(createdAt)}</time>
    </div>
  </article>
);

const ForumReplyItem: React.FC<{ reply: ForumReply }> = ({ reply }) => (
  <ForumPost body={reply.body} authorLabel={reply.authorLabel} createdAt={reply.createdAt} />
);

const ForumThreadView: React.FC<ForumThreadViewProps> = ({ topic, signedIn, posting, onReply }) => {
  if (!topic) {
    return (
      <section className="pearl-themed-app-panel flex min-h-[260px] items-center justify-center rounded-md border p-4 text-center text-sm opacity-70">
        Pick a topic or start one.
      </section>
    );
  }

  return (
    <section className="pearl-themed-app-panel grid min-h-0 gap-4 rounded-md border p-4">
      <header className="grid gap-1">
        <h3 className="m-0 text-base font-semibold leading-tight">{topic.title}</h3>
        <span className="pearl-themed-app-muted text-[11px]">{topic.replyCount} replies</span>
      </header>

      <ForumPost
        kind="topic"
        body={topic.body}
        authorLabel={topic.authorLabel}
        createdAt={topic.createdAt}
      />

      <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-1">
        {topic.replies.map((reply) => (
          <ForumReplyItem key={reply.id} reply={reply} />
        ))}
      </div>

      <ForumComposer
        mode="reply"
        signedIn={signedIn}
        posting={posting}
        onSubmit={async (_title, body) => onReply(topic.id, body)}
      />
    </section>
  );
};

export default ForumThreadView;
