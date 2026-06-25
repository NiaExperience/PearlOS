"use client";

import React from "react";
import type { ForumTopic } from "@interface/lib/our-pearlos-forum-store";

interface ForumTopicListProps {
  topics: ForumTopic[];
  selectedTopicId: string | null;
  onSelect: (topicId: string) => void;
}

function shortTime(value: number): string {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

const ForumTopicList: React.FC<ForumTopicListProps> = ({ topics, selectedTopicId, onSelect }) => (
  <aside className="grid min-h-0 gap-2">
    <div className="pearl-themed-app-muted flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.1em]">
      <span>Topics</span>
      <span>{topics.length}</span>
    </div>
    <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1">
      {topics.length === 0 ? (
        <p className="pearl-themed-app-panel rounded-md border px-3 py-4 text-center text-[12px] opacity-70">
          No topics yet.
        </p>
      ) : topics.map((topic) => (
        <button
          key={topic.id}
          type="button"
          onClick={() => onSelect(topic.id)}
          className="pearl-themed-app-panel rounded-md border p-3 text-left transition hover:opacity-90"
          style={{
            borderColor: topic.id === selectedTopicId
              ? "color-mix(in srgb, var(--pearl-accent), transparent 35%)"
              : "var(--pearl-window-border)",
          }}
        >
          <strong className="block truncate text-sm">{topic.title}</strong>
          <span className="pearl-themed-app-muted mt-1 block truncate text-[11px]">
            {topic.replyCount} replies · {shortTime(topic.lastReplyAt)}
          </span>
        </button>
      ))}
    </div>
  </aside>
);

export default ForumTopicList;
