"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PulseTopic, PulseTrend } from "../lib/pulse-types";

interface PulseTopicListProps {
  topics: PulseTopic[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (topic: PulseTopic) => void;
}

const TREND_ICON: Record<PulseTrend, LucideIcon> = {
  rising: ArrowUpRight,
  steady: Minus,
  falling: ArrowDownRight,
};

export const PulseTopicList: React.FC<PulseTopicListProps> = ({ topics, selectedId, loading, onSelect }) => {
  return (
    <aside className="pulse-topic-list" aria-label="Top public conversation topics">
      <div className="pulse-panel-heading">
        <span>Top 10</span>
        {loading ? <em>Scanning...</em> : <em>{topics.length} signals</em>}
      </div>
      <ol>
        {topics.map((topic) => {
          const TrendIcon = TREND_ICON[topic.trend];
          return (
            <li key={topic.id}>
              <button
                type="button"
                className={topic.id === selectedId ? "is-selected" : ""}
                onClick={() => onSelect(topic)}
              >
                <span className="pulse-rank">{topic.rank}</span>
                <span className="pulse-topic-copy">
                  <strong>{topic.title}</strong>
                  <small>{topic.region} · {topic.volumeLabel}</small>
                </span>
                <span className={`pulse-trend pulse-trend-${topic.trend}`}>
                  <TrendIcon size={15} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
};
