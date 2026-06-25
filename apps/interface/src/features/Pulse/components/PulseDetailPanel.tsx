"use client";

import React from "react";
import { ExternalLink, Languages } from "lucide-react";
import type { PulseTopic } from "../lib/pulse-types";

interface PulseDetailPanelProps {
  topic: PulseTopic | null;
  globalCoverageNote: string;
}

export const PulseDetailPanel: React.FC<PulseDetailPanelProps> = ({ topic, globalCoverageNote }) => {
  if (!topic) {
    return (
      <section className="pulse-detail-empty">
        <span>Pulse</span>
        <p>Select a topic or search a phrase.</p>
      </section>
    );
  }

  return (
    <section className="pulse-detail-panel" aria-live="polite">
      <header>
        <div>
          <span className="pulse-eyebrow">{topic.region}</span>
          <h2>{topic.title}</h2>
        </div>
        <div className="pulse-score">
          <strong>{topic.score.toLocaleString()}</strong>
          <span>{topic.trend}</span>
        </div>
      </header>

      <p className="pulse-summary">{topic.summary}</p>

      <div className="pulse-signal-strip" aria-label="Topic signals">
        <span>{topic.volumeLabel}</span>
        <span>{topic.sentimentLabel}</span>
        <span>{topic.languageLabel}</span>
      </div>

      <div className="pulse-detail-grid">
        <section>
          <h3>Highlights</h3>
          <ul>
            {topic.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Source Mix</h3>
          <div className="pulse-source-mix">
            {topic.sourceMix.map((entry) => (
              <span key={entry.source}>{entry.source} · {entry.count}</span>
            ))}
          </div>
          <div className="pulse-source-links">
            {topic.sources.map((source) => (
              <a key={`${source.label}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">
                <ExternalLink size={13} />
                {source.label}
              </a>
            ))}
          </div>
        </section>
      </div>

      <section className="pulse-comments">
        <h3>
          <Languages size={15} />
          Translated comment highlights
        </h3>
        <div className="pulse-comment-list">
          {topic.comments.map((comment) => (
            <article key={comment.id}>
              <p>{comment.translatedText}</p>
              <span>{comment.source} · {comment.region} · {comment.sourceLanguage}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="pulse-coverage">
        <h3>Coverage</h3>
        <p>{topic.coverageNote || globalCoverageNote}</p>
      </section>
    </section>
  );
};
