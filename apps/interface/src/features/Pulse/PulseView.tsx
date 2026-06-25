"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { PulseGlobeBanner } from "./components/PulseGlobeBanner";
import { PulseTopicList } from "./components/PulseTopicList";
import { PulseDetailPanel } from "./components/PulseDetailPanel";
import type { PulseTopic, PulseTopicsResponse } from "./lib/pulse-types";
import "./pulse.css";

const DEFAULT_COVERAGE =
  "Public Reddit, Hacker News, and news-feed signals where available. Not a complete social-network firehose.";

export const PulseView: React.FC = () => {
  const [topics, setTopics] = useState<PulseTopic[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [coverageNote, setCoverageNote] = useState(DEFAULT_COVERAGE);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTopics = useCallback(async (topicQuery = "") => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "10" });
      if (topicQuery.trim()) params.set("topic", topicQuery.trim());
      const res = await fetch(`/api/pulse/topics?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(json?.topics)) {
        throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`);
      }
      const data = json as PulseTopicsResponse;
      setTopics(data.topics);
      setCoverageNote(data.coverageNote || DEFAULT_COVERAGE);
      setGeneratedAt(data.generatedAt);
      setSelectedId((current) => {
        if (current && data.topics.some((topic) => topic.id === current)) return current;
        return data.topics[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Pulse signals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTopics("");
  }, [loadTopics]);

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedId) ?? topics[0] ?? null,
    [selectedId, topics],
  );

  const handleSearch = useCallback(() => {
    const next = query.trim();
    setActiveQuery(next);
    void loadTopics(next);
  }, [loadTopics, query]);

  return (
    <main className="pulse-app" aria-label="Pulse">
      <PulseGlobeBanner
        topics={topics}
        selectedId={selectedTopic?.id ?? null}
        query={query}
        loading={loading}
        coverageNote={coverageNote}
        onQueryChange={setQuery}
        onSearch={handleSearch}
        onSelect={(topic) => setSelectedId(topic.id)}
      />

      <div className="pulse-status-row">
        <span>{activeQuery ? `Topic search: ${activeQuery}` : "Global top signals"}</span>
        <span>{generatedAt ? `Updated ${new Date(generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Fresh scan"}</span>
      </div>

      {error ? (
        <div className="pulse-error">
          <AlertCircle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => void loadTopics(activeQuery)}>Retry</button>
        </div>
      ) : null}

      <div className="pulse-workspace">
        <PulseTopicList
          topics={topics}
          selectedId={selectedTopic?.id ?? null}
          loading={loading}
          onSelect={(topic) => setSelectedId(topic.id)}
        />
        <PulseDetailPanel topic={selectedTopic} globalCoverageNote={coverageNote} />
      </div>

      {loading && topics.length === 0 ? (
        <div className="pulse-loading">
          <Loader2 size={18} className="animate-spin" />
          <span>Scanning public signals...</span>
        </div>
      ) : null}
    </main>
  );
};

export default PulseView;
