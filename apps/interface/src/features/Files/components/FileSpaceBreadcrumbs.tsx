'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

interface FileSpaceBreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function FileSpaceBreadcrumbs({ currentPath, onNavigate }: FileSpaceBreadcrumbsProps) {
  const parts = currentPath.split('/').filter(Boolean);

  return (
    <div className="filespace-breadcrumbs">
      <div className="filespace-breadcrumb-list" aria-label="Folder path">
        <button type="button" onClick={() => onNavigate('')}>
          FileSpace
        </button>
        {parts.map((part, index) => {
          const path = parts.slice(0, index + 1).join('/');
          return (
            <React.Fragment key={path}>
              <ChevronRight size={17} />
              <button type="button" onClick={() => onNavigate(path)}>
                {part}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
