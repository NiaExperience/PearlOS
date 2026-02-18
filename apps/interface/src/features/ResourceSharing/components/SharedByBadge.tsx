'use client';

import { Users } from 'lucide-react';
import React from 'react';

interface SharedByBadgeProps {
  /** Email or name of the resource owner */
  ownerName: string;
  /** Optional custom className */
  className?: string;
}

/**
 * SharedByBadge Component
 * 
 * Displays a badge indicating that a resource is shared by another user.
 * Shows with dark green styling to indicate shared content that the current
 * user has access to but doesn't own.
 * 
 * Features:
 * - Dark green color scheme (emerald-600)
 * - Users icon from lucide-react
 * - Tooltip showing owner information
 * - Compact, inline design
 * - Accessible with proper ARIA labels
 * 
 * @example
 * ```tsx
 * <SharedByBadge ownerName="john@example.com" />
 * ```
 */
export default function SharedByBadge({ ownerName, className = '' }: SharedByBadgeProps) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-100 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-700 ${className}`}
      title={`Shared by ${ownerName}`}
      role="status"
      aria-label={`Shared by ${ownerName}`}
    >
      <Users className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Shared by {ownerName}
      </span>
    </div>
  );
}
