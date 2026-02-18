'use client';

import type { IOrganization } from '@nia/prism/core/blocks/organization.block';
import { X } from 'lucide-react';
import { usePostHog } from 'posthog-js/react';
import React, { useState } from 'react';

import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@interface/components/ui/card';
import { getClientLogger } from '@interface/lib/client-logger';

/**
 * Role mapping for user-friendly display
 * Read-Only → VIEWER (can view but not edit)
 * Read-Write → ADMIN (can view and edit)
 */
type AccessLevel = 'read-only' | 'read-write';

interface SharingModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** The sharing organization for this resource */
  organization: IOrganization;
  /** Current tenant ID */
  tenantId: string;
  /** Current user ID (owner) */
  currentUserId: string;
  /** Resource info */
  resource: {
    title: string;
    type: 'Notes' | 'HtmlGeneration';
  };
  /** The assistant name (subDomain) to redirect to after redemption */
  assistantName?: string;
  /** Callback when sharing state changes */
  onSharingUpdated?: () => void;
}

/**
 * SharingModal Component
 * 
 * Modal dialog for sharing resources via SMS. Provides two buttons:
 * - Share: Generates read-only link and opens SMS app
 * - Collaborative Share: Generates read-write link and opens SMS app
 */
export default function SharingModal({
  isOpen,
  onClose,
  organization,
  tenantId,
  currentUserId,
  resource,
  assistantName,
  onSharingUpdated,
}: SharingModalProps) {
  const posthog = usePostHog();
  const logger = getClientLogger('SharingModal');
  const { title: resourceTitle, type: resourceType } = resource;
  
  // Link sharing state - track links for both access levels separately
  const [readOnlyLink, setReadOnlyLink] = useState<string | null>(null);
  const [readWriteLink, setReadWriteLink] = useState<string | null>(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [generatingLinkType, setGeneratingLinkType] = useState<AccessLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Button pressed states
  const [sharePressed, setSharePressed] = useState(false);
  const [collabPressed, setCollabPressed] = useState(false);

  if (!isOpen) return null;

  /**
   * Handle generating a shareable link for a specific access level
   */
  const generateLinkForAccessLevel = async (accessLevel: AccessLevel): Promise<string | null> => {
    setError(null);
    try {
      // Map access level to ResourceShareRole
      const role = accessLevel === 'read-only' ? 'viewer' : 'member';
      // resourceId is key in organization.sharedResources
      const resourceId = Object.keys(organization.sharedResources || {})[0];
      
      if (!resourceId) throw new Error('No resource found in organization');

      const res = await fetch('/api/share/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId,
          contentType: resourceType,
          role,
          ttl: 86400, // Default 24h in seconds
          mode: resourceType === 'HtmlGeneration' ? 'creative' : undefined,
          assistantName,
          tenantId
        })
      });
      
      const data = await res.json();
      if (data.success) {
        // Store link based on access level - CRITICAL: Each access level gets its own link
        if (accessLevel === 'read-only') {
          setReadOnlyLink(data.link);
        } else {
          setReadWriteLink(data.link);
        }
        return data.link;
      } else {
        setError(data.error || 'Failed to generate link');
        return null;
      }
    } catch (err) {
      setError('Failed to generate link');
      return null;
    }
  };

  /**
   * Handle share button click - generates link and opens SMS app
   */
  const handleShareClick = async (accessLevel: AccessLevel) => {
    setIsGeneratingLink(true);
    setGeneratingLinkType(accessLevel);
    setError(null);
    
    try {
      // Check if we already have a link for this access level
      // CRITICAL: Each button uses its own separate link state
      let link: string | null = null;
      
      if (accessLevel === 'read-only' && readOnlyLink) {
        link = readOnlyLink;
      } else if (accessLevel === 'read-write' && readWriteLink) {
        link = readWriteLink;
      } else {
        // Generate new link for this specific access level
        link = await generateLinkForAccessLevel(accessLevel);
      }
      
      if (link) {
        // Ensure link is properly formatted - trim and ensure it's a valid URL
        const cleanLink = link.trim();
        
        // Validate the link is complete (should start with http:// or https://)
        if (!cleanLink.startsWith('http://') && !cleanLink.startsWith('https://')) {
          setError('Invalid link format');
          return;
        }
        
        // Format message with URL isolated on its own line
        // Keep the full link intact - SMS apps may only detect part of it, but users can copy the full text
        const message = `Something cool is happening at PearlOS right now, check it out!\n\n${cleanLink}`;
        const encodedMessage = encodeURIComponent(message);
        const smsUrl = `sms:?body=${encodedMessage}`;
        
        // Open SMS app
        window.location.href = smsUrl;
        
        posthog?.capture('sharing_link_shared_via_sms', { 
          resourceType, 
          accessLevel 
        });
        
        // Notify parent
        onSharingUpdated?.();
      }
    } catch (err) {
      logger.error('Error sharing link', { error: err });
      setError('Failed to share link');
    } finally {
      setIsGeneratingLink(false);
      setGeneratingLinkType(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[650] flex items-center justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg z-[700]">
        <Card className="bg-gray-900 border-gray-700 shadow-2xl" style={{ fontFamily: 'Gohufont, monospace' }}>
          <CardHeader className="relative flex flex-row items-center justify-center space-y-0 pb-4">
            <div className="flex items-center gap-2">
              {/* Email icon image */}
              <img
                src="/EmailIcon.png"
                alt="Email"
                className="shrink-0"
                style={{
                  imageRendering: 'pixelated',
                  width: '32px',
                  height: '22px',
                }}
              />
              <CardTitle className="text-xl text-white whitespace-nowrap" style={{ fontFamily: 'Gohufont, monospace', fontWeight: 'normal', letterSpacing: '-0.5px' }}>
                Share with a Friend
              </CardTitle>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose} 
              className="absolute right-0 text-gray-400 hover:text-white hover:bg-gray-800"
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>

          <CardContent style={{ fontFamily: 'Gohufont, monospace' }}>
            <div className="space-y-4">
              {error && (
                <div
                  role="status"
                  className="rounded-md px-3 py-2 text-sm bg-red-900/40 text-red-200 border-red-700 border"
                  style={{
                    imageRendering: 'pixelated',
                    boxShadow: '0 0 0 2px #7f1d1d, 2px 2px 0 #3f0f0f',
                    fontFamily: 'Gohufont, monospace',
                  }}
                >
                  {error}
                </div>
              )}

              <div className="flex flex-row gap-4 items-center justify-center">
                <Button
                  onClick={() => handleShareClick('read-only')}
                  disabled={isGeneratingLink}
                  onMouseDown={() => setSharePressed(true)}
                  onMouseUp={() => setSharePressed(false)}
                  onMouseLeave={() => setSharePressed(false)}
                  className="text-white font-semibold p-0 flex items-center justify-center"
                  style={{
                    width: '200px',
                    height: '72px',
                    backgroundImage: `url(${sharePressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    imageRendering: 'pixelated',
                    border: '0',
                    boxShadow: 'none',
                    fontFamily: 'Gohufont, monospace',
                    overflow: 'hidden',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    padding: '0 12px',
                    fontSize: '14px',
                    lineHeight: '1.2',
                  }}
                >
                  {isGeneratingLink && generatingLinkType === 'read-only' ? 'Generating…' : 'Share'}
                </Button>

                <Button
                  onClick={() => handleShareClick('read-write')}
                  disabled={isGeneratingLink}
                  onMouseDown={() => setCollabPressed(true)}
                  onMouseUp={() => setCollabPressed(false)}
                  onMouseLeave={() => setCollabPressed(false)}
                  className="text-white font-semibold p-0 flex items-center justify-center"
                  style={{
                    width: '200px',
                    height: '72px',
                    backgroundImage: `url(${collabPressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    imageRendering: 'pixelated',
                    border: '0',
                    boxShadow: 'none',
                    fontFamily: 'Gohufont, monospace',
                    overflow: 'hidden',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    padding: '0 12px',
                    fontSize: '14px',
                    lineHeight: '1.2',
                  }}
                >
                  {isGeneratingLink && generatingLinkType === 'read-write' ? 'Generating…' : 'Share & Play'}
                </Button>
              </div>

              <div className="pt-4 text-center">
                <p className="text-sm text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>
                  Available for 24 hr
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
