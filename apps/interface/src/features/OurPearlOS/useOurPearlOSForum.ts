"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ForumTopic } from "@interface/lib/our-pearlos-forum-store";

interface ForumState {
  topics: ForumTopic[];
  selectedTopicId: string | null;
  signedIn: boolean;
  viewerLabel: string | null;
  loading: boolean;
  posting: boolean;
  error: string | null;
}

const INITIAL_STATE: ForumState = {
  topics: [],
  selectedTopicId: null,
  signedIn: false,
  viewerLabel: null,
  loading: true,
  posting: false,
  error: null,
};

function sortTopics(topics: ForumTopic[]): ForumTopic[] {
  return [...topics].sort((a, b) => b.lastReplyAt - a.lastReplyAt || b.createdAt - a.createdAt);
}

function replaceTopic(topics: ForumTopic[], topic: ForumTopic): ForumTopic[] {
  return sortTopics([topic, ...topics.filter((entry) => entry.id !== topic.id)]);
}

export function useOurPearlOSForum() {
  const [state, setState] = useState<ForumState>(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/our-pearlos/forum", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(json?.topics)) {
        throw new Error(typeof json?.error === "string" ? json.error : `Forum failed (${res.status})`);
      }
      const topics = json.topics as ForumTopic[];
      setState((prev) => ({
        ...prev,
        topics,
        selectedTopicId: prev.selectedTopicId && topics.some((topic) => topic.id === prev.selectedTopicId)
          ? prev.selectedTopicId
          : topics[0]?.id ?? null,
        signedIn: json.signedIn === true,
        viewerLabel: typeof json.viewerLabel === "string" ? json.viewerLabel : null,
        loading: false,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Could not load the forum.",
      }));
    }
  }, []);

  const createTopic = useCallback(async (title: string, body: string) => {
    setState((prev) => ({ ...prev, posting: true, error: null }));
    try {
      const res = await fetch("/api/our-pearlos/forum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "topic", title, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.topic) throw new Error(typeof json?.error === "string" ? json.error : "Could not post topic.");
      const topic = json.topic as ForumTopic;
      setState((prev) => ({
        ...prev,
        topics: replaceTopic(prev.topics, topic),
        selectedTopicId: topic.id,
        posting: false,
      }));
      return true;
    } catch (err) {
      setState((prev) => ({ ...prev, posting: false, error: err instanceof Error ? err.message : "Could not post topic." }));
      return false;
    }
  }, []);

  const replyToTopic = useCallback(async (topicId: string, body: string) => {
    setState((prev) => ({ ...prev, posting: true, error: null }));
    try {
      const res = await fetch("/api/our-pearlos/forum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", topicId, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.topic) throw new Error(typeof json?.error === "string" ? json.error : "Could not post reply.");
      const topic = json.topic as ForumTopic;
      setState((prev) => ({
        ...prev,
        topics: replaceTopic(prev.topics, topic),
        selectedTopicId: topic.id,
        posting: false,
      }));
      return true;
    } catch (err) {
      setState((prev) => ({ ...prev, posting: false, error: err instanceof Error ? err.message : "Could not post reply." }));
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedTopic = useMemo(
    () => state.topics.find((topic) => topic.id === state.selectedTopicId) ?? state.topics[0] ?? null,
    [state.selectedTopicId, state.topics],
  );

  return { ...state, selectedTopic, setSelectedTopicId: (id: string) => setState((prev) => ({ ...prev, selectedTopicId: id })), refresh, createTopic, replyToTopic };
}
