'use client';

import React from 'react';
import { Upload } from 'lucide-react';

interface FileSpaceUploadButtonProps {
  onClick: () => void;
}

export function FileSpaceUploadButton({ onClick }: FileSpaceUploadButtonProps) {
  return (
    <button type="button" className="filespace-upload-fab" aria-label="Upload files" onClick={onClick}>
      <Upload size={24} />
    </button>
  );
}
