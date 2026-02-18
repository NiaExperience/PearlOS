'use client';

import { Users } from 'lucide-react';
import React from 'react';

interface SharedIndicatorProps {
  /** Optional custom className */
  className?: string;
  /** Icon size class (default: h-4 w-4) */
  size?: string;
}

/**
 * SharedIndicator Component
 * 
 * Small icon indicator showing that a resource is shared.
 * Typically displayed as a prefix to resource titles in lists.
 * 
 * Features:
 * - Compact Users icon from lucide-react
 * - Bright green coloring (✅ green) to indicate shared status
 * - Customizable size
 * - Accessible with proper ARIA label
 * 
 * @example
 * ```tsx
 * <SharedIndicator />
 * <SharedIndicator size="h-3 w-3" />
 * ```
 */
export default function SharedIndicator({ 
  className = '', 
  size = 'h-4 w-4' 
}: SharedIndicatorProps) {
  return (
    <Users 
      className={`${size} text-green-500 ${className}`}
      aria-label="Shared resource"
      role="img"
    />
  );
}
