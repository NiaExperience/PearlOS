"use client";

interface ProgressOverlayProps {
  progress: number;
  progressText: string;
  prompt: string;
  sourceImage: string | null;
}

export function ProgressOverlay({ progress, progressText, prompt, sourceImage }: ProgressOverlayProps) {
  return (
    <div className="pm-progress">
      {sourceImage && (
        <div className="pm-progress__image-wrap">
          <img src={sourceImage} alt="Source" className="pm-progress__image" />
          <div className="pm-progress__shimmer" />
        </div>
      )}

      <div className="pm-progress__bar-track">
        <div
          className="pm-progress__bar-fill"
          style={{ width: `${Math.max(3, progress)}%` }}
        />
      </div>

      <div className="pm-progress__label">
        {progressText || 'Pearl is crafting your image\u2026'}
      </div>

      {prompt && (
        <div className="pm-progress__prompt-echo">
          &ldquo;{prompt}&rdquo;
        </div>
      )}
    </div>
  );
}
