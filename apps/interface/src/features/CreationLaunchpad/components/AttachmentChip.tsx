"use client";

import React from "react";

// ─── Shared types ──────────────────────────────────────────────────
export interface SpriteAttachment {
  kind: "sprite";
  id: string;
  name: string;
  imageUrl: string;
  description?: string;
}

export interface NoteAttachment {
  kind: "note";
  id: string;
  title: string;
  content: string;
}

export type Attachment = SpriteAttachment | NoteAttachment;

// ─── Project sprite shape (legacy, used by ProjectMenu) ────────────
export interface ProjectSprite {
  id: string;
  name: string;
  imageUrl: string;
}

// ─── AttachmentChip ────────────────────────────────────────────────
const AttachmentChip: React.FC<{
  attachment: Attachment;
  onRemove?: (id: string) => void;
  editable?: boolean;
}> = ({ attachment, onRemove, editable = true }) => {
  if (attachment.kind === "sprite") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 max-w-[220px]">
        {attachment.imageUrl && (
          <img
            src={attachment.imageUrl}
            alt=""
            className="w-4 h-4 rounded-full object-cover"
          />
        )}
        <span className="text-[10px] text-cyan-300/80 truncate" title={attachment.name}>
          {attachment.name}
        </span>
        {editable && onRemove && (
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
            className="text-cyan-300/50 hover:text-cyan-300 text-[10px] leading-none ml-0.5"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // note
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[#D94F8E]/30 bg-[#D94F8E]/10 px-2.5 py-1 max-w-[220px]">
      <span aria-hidden className="text-[11px]">📝</span>
      <span
        className="text-[11px] text-[#faf8f5]/90 truncate"
        title={attachment.title}
      >
        {attachment.title || "Untitled note"}
      </span>
      {editable && onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove ${attachment.title || "note"}`}
          className="text-[#d4c0e8]/60 hover:text-[#faf8f5] text-[11px] leading-none ml-0.5"
        >
          ×
        </button>
      )}
    </div>
  );
};

// ─── Sprite-only chip wrapper kept for back-compat with ProjectMenu ─
export const SpriteChips: React.FC<{
  sprites: ProjectSprite[];
  onRemove?: (spriteId: string) => void;
  editable?: boolean;
}> = ({ sprites, onRemove, editable }) => {
  if (sprites.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sprites.map((sprite) => (
        <AttachmentChip
          key={sprite.id}
          attachment={{
            kind: "sprite",
            id: sprite.id,
            name: sprite.name,
            imageUrl: sprite.imageUrl,
          }}
          onRemove={onRemove}
          editable={editable}
        />
      ))}
    </div>
  );
};

export default AttachmentChip;
