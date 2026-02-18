"use client";

import { useState, useCallback, useRef, type KeyboardEvent } from 'react';
import '@interface/features/PhotoMagic/styles/photo-magic.css';
import { usePhotoMagic } from '../hooks/usePhotoMagic';
import { DropZone } from './DropZone';
import { ProgressOverlay } from './ProgressOverlay';
import { ImageResult } from './ImageResult';
import { InpaintCanvas } from './InpaintCanvas';

export interface PhotoMagicViewProps {
  /** Optional initial prompt passed from voice command or taskbar */
  initialPrompt?: string;
}

export default function PhotoMagicView({ initialPrompt }: PhotoMagicViewProps) {
  const {
    state,
    progress,
    progressText,
    result,
    error,
    sourceImage,
    prompt: activePrompt,
    generate,
    inpaint,
    reset,
    editAgain,
  } = usePhotoMagic();

  const [promptText, setPromptText] = useState(initialPrompt || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [inpaintMode, setInpaintMode] = useState(false);
  const [maskBlob, setMaskBlob] = useState<Blob | null>(null);
  const [showMultiImages, setShowMultiImages] = useState(false);
  const [additionalFiles, setAdditionalFiles] = useState<Array<{ file: File; preview: string }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    setFilePreview(URL.createObjectURL(file));
    setInpaintMode(false);
    setMaskBlob(null);
  }, []);

  const handleClearFile = useCallback(() => {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setSelectedFile(null);
    setFilePreview(null);
    setInpaintMode(false);
    setMaskBlob(null);
  }, [filePreview]);

  const handleAddFile = useCallback((index: number, file: File) => {
    setAdditionalFiles(prev => {
      const next = [...prev];
      if (next[index]) URL.revokeObjectURL(next[index].preview);
      next[index] = { file, preview: URL.createObjectURL(file) };
      return next;
    });
  }, []);

  const handleRemoveAdditional = useCallback((index: number) => {
    setAdditionalFiles(prev => {
      const next = [...prev];
      if (next[index]) URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const handleMaskReady = useCallback((blob: Blob) => {
    setMaskBlob(blob);
    setInpaintMode(false);
  }, []);

  const handleSubmit = useCallback(() => {
    const text = promptText.trim();
    if (!text && !selectedFile) return;

    const p = text || 'enhance this image';

    if (selectedFile && maskBlob) {
      // Inpaint mode
      inpaint(p, selectedFile, maskBlob);
    } else {
      const extra = additionalFiles.map(af => af.file);
      generate(p, selectedFile || undefined, extra.length > 0 ? extra : undefined);
    }

    setPromptText('');
    handleClearFile();
    setAdditionalFiles([]);
    setShowMultiImages(false);
    setMaskBlob(null);
  }, [promptText, selectedFile, maskBlob, additionalFiles, generate, inpaint, handleClearFile]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleReset = useCallback(() => {
    reset();
    setPromptText('');
    handleClearFile();
    setAdditionalFiles([]);
    setShowMultiImages(false);
    setMaskBlob(null);
  }, [reset, handleClearFile]);

  // ─── Inpaint canvas overlay ───

  if (inpaintMode && filePreview && selectedFile) {
    return (
      <div className="photo-magic">
        <InpaintCanvas
          imageUrl={filePreview}
          onMaskReady={handleMaskReady}
          onClose={() => setInpaintMode(false)}
        />
      </div>
    );
  }

  // ─── Render states ───

  if (state === 'processing') {
    return (
      <div className="photo-magic">
        <ProgressOverlay
          progress={progress}
          progressText={progressText}
          prompt={activePrompt}
          sourceImage={sourceImage}
        />
      </div>
    );
  }

  if (state === 'result' && result) {
    return (
      <div className="photo-magic">
        <ImageResult result={result} onEditAgain={editAgain} onReset={handleReset} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="photo-magic">
        <div className="pm-error">
          <div className="pm-error__msg">{error || 'Something went wrong'}</div>
          <button className="pm-action-btn" onClick={handleReset}>Try again</button>
        </div>
      </div>
    );
  }

  // ─── Landing / idle ───

  return (
    <div className="photo-magic">
      <div className="pm-landing">
        <div className="pm-landing__tagline">
          Describe what you see, or drop a photo to <em>transform</em> it.
        </div>

        <DropZone
          onFile={handleFile}
          file={selectedFile}
          onClear={handleClearFile}
          previewUrl={filePreview}
        />

        {/* Inpaint toggle — only when an image is loaded */}
        {selectedFile && filePreview && (
          <div className="pm-inpaint-toggle-row">
            <button
              className={`pm-inpaint-toggle ${maskBlob ? 'has-mask' : ''}`}
              onClick={() => setInpaintMode(true)}
              title="Paint areas to edit (inpaint)"
            >
              <span className="pm-inpaint-toggle__icon">✎</span>
              {maskBlob ? 'Mask ready — tap to edit' : 'Paint areas to change'}
            </button>
            {maskBlob && (
              <button
                className="pm-inpaint-tool-btn"
                onClick={() => setMaskBlob(null)}
                title="Clear mask"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Multi-image section */}
        {selectedFile && (
          <div className="pm-multi-images">
            {!showMultiImages ? (
              <button
                className="pm-multi-images__expand"
                onClick={() => setShowMultiImages(true)}
              >
                + Add reference images
              </button>
            ) : (
              <div className="pm-multi-images__slots">
                <div className="pm-multi-images__header">
                  <span className="pm-multi-images__label">Reference images</span>
                  <button
                    className="pm-inpaint-tool-btn"
                    onClick={() => {
                      additionalFiles.forEach(af => URL.revokeObjectURL(af.preview));
                      setAdditionalFiles([]);
                      setShowMultiImages(false);
                    }}
                  >
                    ✕
                  </button>
                </div>
                {[0, 1].map(idx => (
                  <div key={idx} className="pm-multi-images__slot">
                    {additionalFiles[idx] ? (
                      <div className="pm-multi-images__thumb">
                        <img src={additionalFiles[idx].preview} alt={`Ref ${idx + 2}`} />
                        <button
                          className="pm-dropzone__clear"
                          onClick={() => handleRemoveAdditional(idx)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="pm-multi-images__add">
                        <span>+ Image {idx + 2}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleAddFile(idx, f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pm-prompt-row">
          <button
            className="pm-file-btn"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/png,image/jpeg,image/webp,image/gif';
              input.capture = 'environment';
              input.onchange = (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) handleFile(f);
              };
              input.click();
            }}
            aria-label="Choose photo"
            title="Choose photo"
          >
            ◉
          </button>

          <textarea
            ref={textareaRef}
            className="pm-prompt-input"
            placeholder={maskBlob ? 'Describe what to change in painted area…' : 'Describe your vision…'}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />

          <button
            className="pm-send-btn"
            onClick={handleSubmit}
            disabled={!promptText.trim() && !selectedFile}
            aria-label="Generate"
            title="Generate"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
