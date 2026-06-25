"use client";

import React, { useState } from "react";
import { Loader2, Send } from "lucide-react";

interface ForumComposerProps {
  mode: "topic" | "reply";
  signedIn: boolean;
  posting: boolean;
  onSubmit: (title: string, body: string) => Promise<boolean>;
}

const ForumComposer: React.FC<ForumComposerProps> = ({ mode, signedIn, posting, onSubmit }) => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const isTopic = mode === "topic";
  const canSubmit = signedIn && !posting && body.trim().length > 0 && (!isTopic || title.trim().length > 0);

  return (
    <form
      className="pearl-themed-app-panel grid gap-2 rounded-md border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSubmit) return;
        const posted = await onSubmit(title.trim(), body.trim());
        if (posted) {
          setTitle("");
          setBody("");
        }
      }}
    >
      {isTopic ? (
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          disabled={!signedIn || posting}
          className="rounded border bg-transparent px-2 py-2 text-sm outline-none"
          style={{ borderColor: "var(--pearl-window-border)", color: "var(--pearl-text)" }}
          placeholder="Topic title"
        />
      ) : null}
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={isTopic ? 1600 : 1200}
        rows={isTopic ? 3 : 2}
        disabled={!signedIn || posting}
        className="resize-none rounded border bg-transparent px-2 py-2 text-sm leading-5 outline-none"
        style={{ borderColor: "var(--pearl-window-border)", color: "var(--pearl-text)" }}
        placeholder={isTopic ? "Start a topic" : "Write a reply"}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="pearl-themed-app-muted text-[11px]">
          {signedIn ? `${body.length}/${isTopic ? 1600 : 1200}` : "Sign in to post"}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-[11px] font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: "color-mix(in srgb, var(--pearl-accent), transparent 78%)",
            borderColor: "color-mix(in srgb, var(--pearl-accent), transparent 48%)",
            color: "var(--pearl-text)",
          }}
        >
          {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          <span>{isTopic ? "Post" : "Reply"}</span>
        </button>
      </div>
    </form>
  );
};

export default ForumComposer;
