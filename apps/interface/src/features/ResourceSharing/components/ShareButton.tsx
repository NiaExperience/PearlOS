'use client';

import { Share2 } from 'lucide-react';
import React from 'react';

import { Button } from '@interface/components/ui/button';

interface ShareButtonProps {
  /** Click handler for opening share modal */
  onClick: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Optional custom className */
  className?: string;
  /** Button variant (default: ghost) */
  variant?: 'default' | 'ghost' | 'outline' | 'secondary';
  /** Button size (default: sm) */
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * ShareButton Component
 * 
 * Button for opening the sharing modal to manage resource access.
 * Uses Share2 icon (square with up-arrow) from lucide-react.
 * 
 * Features:
 * - Share2 icon with clear share action
 * - Configurable variant and size
 * - Hover states via shadcn Button
 * - Accessible with proper labels
 * - Consistent with platform button styling
 * 
 * @example
 * ```tsx
 * <ShareButton onClick={() => setShowModal(true)} />
 * <ShareButton 
 *   onClick={handleShare} 
 *   variant="outline"
 *   size="sm"
 * />
 * ```
 */
export default function ShareButton({ 
  onClick, 
  disabled = false,
  className = '',
  variant = 'ghost',
  size = 'sm'
}: ShareButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      variant={variant}
      size={size}
      className={`gap-1.5 ${className}`}
      title="Share resource"
      aria-label="Share resource"
    >
      <Share2 className="h-4 w-4" />
      <span className="hidden sm:inline">Share</span>
    </Button>
  );
}
