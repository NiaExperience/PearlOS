'use client';

import React from 'react';
import { FolderClosed, HardDrive, Users } from 'lucide-react';

import type { FileSpaceEntry } from './filespace-types';

interface FileSpaceSidebarProps {
  folders: FileSpaceEntry[];
  currentPath: string;
  activeSection: 'files' | 'shared';
  onNavigate: (path: string) => void;
  onShowFiles: () => void;
  onShowShared: () => void;
}

export function FileSpaceSidebar({
  folders,
  currentPath,
  activeSection,
  onNavigate,
  onShowFiles,
  onShowShared,
}: FileSpaceSidebarProps) {
  return (
    <aside className="filespace-sidebar">
      <button
        type="button"
        className={activeSection === 'files' && !currentPath ? 'is-active' : ''}
        onClick={() => {
          onShowFiles();
          onNavigate('');
        }}
      >
        <HardDrive size={15} />
        Your files
      </button>
      <button
        type="button"
        className={activeSection === 'shared' ? 'is-active' : ''}
        onClick={onShowShared}
      >
        <Users size={15} />
        Shared with Me
      </button>
      <div className="filespace-sidebar-tree">
        {folders.map((folder) => (
          <button
            type="button"
            key={folder.path}
            className={activeSection === 'files' && currentPath === folder.path ? 'is-active' : ''}
            onClick={() => {
              onShowFiles();
              onNavigate(folder.path);
            }}
          >
            <FolderClosed size={14} />
            <span>{folder.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
