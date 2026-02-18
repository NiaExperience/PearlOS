'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@dashboard/components/ui/button';

interface CopyLinkButtonProps {
  linkKey: string;
}

export function CopyLinkButton({ linkKey }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const baseUrl = process.env.NEXT_PUBLIC_INTERFACE_BASE_URL || 'http://localhost:3000';
    const url = `${baseUrl}/share/${linkKey}`;
    
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      title="Copy Link"
      className="h-8 w-8"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}
