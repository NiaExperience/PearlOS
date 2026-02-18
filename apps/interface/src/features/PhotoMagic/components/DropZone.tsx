"use client";

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';

interface DropZoneProps {
  onFile: (file: File) => void;
  file: File | null;
  onClear: () => void;
  previewUrl: string | null;
}

export function DropZone({ onFile, file, onClear, previewUrl }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      onFile(droppedFile);
    }
  }, [onFile]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && selected.type.startsWith('image/')) {
      onFile(selected);
    }
    // reset so same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  }, [onFile]);

  const handleClick = useCallback(() => {
    if (!file) inputRef.current?.click();
  }, [file]);

  return (
    <div
      className={`pm-dropzone ${dragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={file ? `Selected: ${file.name}` : 'Drop a photo or click to browse'}
    >
      <span className="pm-corner pm-corner--tl" />
      <span className="pm-corner pm-corner--br" />

      {previewUrl && file ? (
        <>
          <img src={previewUrl} alt="Selected" className="pm-dropzone__preview" />
          <div className="pm-dropzone__subtitle">{file.name}</div>
          <button
            className="pm-dropzone__clear"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            aria-label="Remove image"
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <div className="pm-dropzone__icon">
            {dragging ? '✦' : '◐'}
          </div>
          <div className="pm-dropzone__title">
            {dragging ? 'Release to enchant' : 'Drop a photo to edit'}
          </div>
          <div className="pm-dropzone__subtitle">
            or click to browse · png, jpg, webp
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        capture="environment"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
