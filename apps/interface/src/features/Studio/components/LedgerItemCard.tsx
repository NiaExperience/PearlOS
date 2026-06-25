"use client";

import React from "react";
import { AlertCircle, Check, FileCode2, LayoutTemplate, Loader2, Share2 } from "lucide-react";
import type { StudioLedgerItem, StudioLedgerStatus } from "@interface/lib/studio-ledger";

interface LedgerItemCardProps {
  item: StudioLedgerItem;
  /** Called after a successful publish so the parent can refresh the ledger. */
  onShared?: () => void;
}

const STATUS_LABEL: Record<StudioLedgerStatus, string> = {
  applied: "Applied",
  needs_review: "In review",
  failed: "Failed",
};

const STATUS_HUE: Record<StudioLedgerStatus, string> = {
  applied: "#5fd0a0",
  needs_review: "#e0c45f",
  failed: "#e07a7a",
};

type ShareState = "idle" | "sharing" | "error";

/** Show only the artifact filename, never the internal directory structure. */
function artifactName(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

const LedgerItemCard: React.FC<LedgerItemCardProps> = ({ item, onShared }) => {
  const [shareState, setShareState] = React.useState<ShareState>("idle");
  const isManifest = item.kind === "ui_manifest";
  const KindIcon = isManifest ? LayoutTemplate : FileCode2;
  const kindLabel = isManifest ? "Live UI manifest" : "Code artifact for review";
  const fileName = artifactName(item.artifactPath);
  const published = Boolean(item.share);

  const handleShare = React.useCallback(async () => {
    setShareState("sharing");
    try {
      const res = await fetch("/api/our-pearlos/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ledgerItemId: item.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : `Share failed (${res.status})`);
      }
      setShareState("idle");
      onShared?.();
    } catch {
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 2500);
    }
  }, [item.id, onShared]);

  return (
    <article className="pearl-themed-app-panel grid gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 text-sm font-semibold leading-snug">{item.title}</h4>
        <span
          className="shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{
            color: STATUS_HUE[item.status],
            borderColor: `color-mix(in srgb, ${STATUS_HUE[item.status]}, transparent 70%)`,
            background: `color-mix(in srgb, ${STATUS_HUE[item.status]}, transparent 88%)`,
          }}
        >
          {STATUS_LABEL[item.status]}
        </span>
      </div>

      {item.summary ? (
        <p className="pearl-themed-app-muted text-[12px] leading-5">{item.summary}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="pearl-themed-app-muted flex min-w-0 items-center gap-1.5 text-[11px]">
          <KindIcon size={13} className="shrink-0" />
          <span className="shrink-0">{kindLabel}</span>
          {fileName ? <span className="truncate font-mono opacity-80">· {fileName}</span> : null}
        </div>

        {published ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-semibold opacity-80">
            <Check size={13} />
            Published
          </span>
        ) : item.shareEligible ? (
          <button
            type="button"
            onClick={() => void handleShare()}
            disabled={shareState === "sharing"}
            className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background:
                shareState === "error"
                  ? "color-mix(in srgb, #e07a7a, transparent 86%)"
                  : "color-mix(in srgb, var(--pearl-accent), transparent 80%)",
              borderColor:
                shareState === "error"
                  ? "color-mix(in srgb, #e07a7a, transparent 55%)"
                  : "color-mix(in srgb, var(--pearl-accent), transparent 52%)",
              color: "var(--pearl-text)",
            }}
            aria-label={`Share ${item.title} to Our PearlOS`}
          >
            {shareState === "sharing" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : shareState === "error" ? (
              <AlertCircle size={13} />
            ) : (
              <Share2 size={13} />
            )}
            <span>{shareState === "error" ? "Try again" : "Share"}</span>
          </button>
        ) : null}
      </div>
    </article>
  );
};

export default LedgerItemCard;
