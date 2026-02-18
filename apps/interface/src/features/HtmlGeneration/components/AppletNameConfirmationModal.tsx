'use client';

import { X } from 'lucide-react';
import React, { useState } from 'react';

interface AppletNameConfirmationModalProps {
  isOpen: boolean;
  suggestedName: string;
  contentType: string;
  onConfirm: (confirmedName: string) => void;
  onCancel: () => void;
}

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gohufont-font-face')) return;
  const style = document.createElement('style');
  style.id = 'gohufont-font-face';
  style.textContent = GOHUFONT_FONT_FACE;
  document.head.appendChild(style);
};

/**
 * Modal component for confirming applet names before creation
 * Displays suggested name with manual editing capability
 */
export function AppletNameConfirmationModal({
  isOpen,
  suggestedName,
  contentType,
  onConfirm,
  onCancel,
}: AppletNameConfirmationModalProps) {
  const [editedName, setEditedName] = useState(suggestedName);
  const [isEditing, setIsEditing] = useState(false);

  // Update edited name when suggested name changes
  React.useEffect(() => {
    setEditedName(suggestedName);
    setIsEditing(false);
  }, [suggestedName]);

  React.useEffect(() => {
    ensureGohufont();
  }, []);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const finalName = editedName.trim() || suggestedName;
    onConfirm(finalName);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        {/* Close button */}
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title="Cancel"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Name Your {contentType === 'game' ? 'Game' : contentType === 'app' ? 'App' : contentType === 'tool' ? 'Tool' : 'Creation'}</h2>
          <p className="mt-2 text-sm text-gray-600">
            I suggest the name below, but you can edit it before we proceed with creation.
          </p>
        </div>

        {/* Name Input */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Applet Name
          </label>
          <div className="relative">
            {isEditing ? (
              <input
                type="text"
                value={editedName}
                onChange={e => setEditedName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => setIsEditing(false)}
                autoFocus
                className="w-full rounded-lg border-2 border-blue-500 px-4 py-3 text-lg font-medium text-gray-900 shadow-sm transition-all focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Enter applet name..."
              />
            ) : (
              <div
                onClick={() => setIsEditing(true)}
                className="w-full cursor-text rounded-lg border-2 border-gray-300 px-4 py-3 text-lg font-medium text-gray-900 shadow-sm transition-all hover:border-gray-400"
                title="Click to edit"
              >
                {editedName || suggestedName}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Click the name to edit it, or say "yes, go forward" to proceed with this name.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border-2 border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 font-medium text-white shadow-md transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg"
          >
            Confirm & Create
          </button>
        </div>

        {/* Voice Command Hint */}
        <div className="mt-4 rounded-lg bg-blue-50 p-3 text-center">
          <p className="text-sm font-medium text-blue-900">
            💬 Say <span className="font-bold">"yes, go forward"</span> or{' '}
            <span className="font-bold">"proceed"</span> to confirm
          </p>
        </div>
      </div>
    </div>
  );
}

