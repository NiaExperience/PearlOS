'use client';

import React from 'react';
import { FileText } from 'lucide-react';

interface FileSpaceIconProps {
  kind: 'folder' | 'file';
  ext?: string;
  size?: 'small' | 'large';
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const CODE_EXTENSIONS = new Set(['js', 'ts', 'tsx', 'jsx', 'py', 'css', 'html', 'json']);

export function FileSpaceIcon({ kind, ext, size = 'large' }: FileSpaceIconProps) {
  const isSmall = size === 'small';
  const label = ext ? ext.toUpperCase().slice(0, 5) : 'FILE';
  const iconClass = isSmall ? 'filespace-file-icon filespace-file-icon--small' : 'filespace-file-icon';

  if (kind === 'folder') {
    return <div aria-hidden="true" className={isSmall ? 'filespace-folder filespace-folder--small' : 'filespace-folder'} />;
  }

  const extensionClass = ext && IMAGE_EXTENSIONS.has(ext)
    ? 'is-image'
    : ext && CODE_EXTENSIONS.has(ext)
      ? 'is-code'
      : '';

  return (
    <div aria-hidden="true" className={`${iconClass} ${extensionClass}`}>
      <FileText size={isSmall ? 30 : 58} strokeWidth={1.6} />
      {ext && <span>{label}</span>}
    </div>
  );
}
