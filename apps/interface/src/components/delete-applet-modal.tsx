'use client';

import { X } from 'lucide-react';

interface DeleteAppletModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting?: boolean;
  appletTitle?: string;
}

export function DeleteAppletModal({
  isOpen,
  onConfirm,
  onCancel,
  isDeleting = false,
  appletTitle,
}: DeleteAppletModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center pointer-events-auto"
      style={{ isolation: 'isolate' }}
    >
      {/* Backdrop */}
      <div
        onClick={isDeleting ? undefined : onCancel}
        className="absolute inset-0 bg-black/50"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm mx-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Delete applet "<span className="text-red-600 dark:text-red-500">{appletTitle || 'Untitled'}</span>" ?
          </h3>
          {!isDeleting && (
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          This will permanently delete the applet "{appletTitle || 'Untitled'}". This action cannot be undone.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Keep applet
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[100px]"
          >
            {isDeleting ? 'Deleting...' : 'Yes, delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

