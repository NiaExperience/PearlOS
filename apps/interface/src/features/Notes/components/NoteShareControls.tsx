'use client';

import { isFeatureEnabled } from '@nia/features';
import type { IOrganization } from '@nia/prism/core/blocks/organization.block';
import { Loader2, Share } from 'lucide-react';
import React, { useState } from 'react';

import { SharedByBadge } from '@interface/features/ResourceSharing/components';
import { createSharingOrganization } from '@interface/features/ResourceSharing/lib';
import { useToast } from '@interface/hooks/use-toast';
import { getClientLogger } from '@interface/lib/client-logger';

import type { Note } from '../types/notes-types';
import NoteSharingModal from './NoteSharingModal';

const log = getClientLogger('Notes');

interface NoteShareControlsProps {
  currentNote: Note | null;
  supportedFeatures?: string[];
  onSharingUpdated?: () => void;
  /** Fallback tenantId if not available on the note (for legacy notes) */
  tenantId?: string;
}

/**
 * Dedicated Notes sharing UI (separate from applet sharing).
 * Renders share button/badge plus the sharing modal lifecycle.
 */
export default function NoteShareControls({
  currentNote,
  supportedFeatures,
  onSharingUpdated,
  tenantId: fallbackTenantId,
}: NoteShareControlsProps) {
  const { toast } = useToast();
  const [showSharingModal, setShowSharingModal] = useState(false);
  const [sharingOrganization, setSharingOrganization] = useState<IOrganization | null>(null);
  const [isCreatingSharingOrg, setIsCreatingSharingOrg] = useState(false);

  const featureEnabled = isFeatureEnabled('resourceSharing', supportedFeatures);
  if (!featureEnabled) return null;

  const handleShareNote = async () => {
    if (!currentNote || !currentNote._id) {
      toast({
        title: 'Cannot Share',
        description: 'Please save the note before sharing.',
        variant: 'destructive',
      });
      return;
    }

    // Use note's tenantId or fallback
    const effectiveTenantId = currentNote.tenantId || fallbackTenantId;
    if (!effectiveTenantId) {
      log.error('Cannot share note: tenantId is missing', { noteId: currentNote._id });
      toast({
        title: 'Cannot Share',
        description: 'This note is missing required data. Please try editing and saving it first.',
        variant: 'destructive',
      });
      return;
    }

    setIsCreatingSharingOrg(true);
    try {
      const org = await createSharingOrganization(
        currentNote._id,
        'Notes',
        currentNote.title || 'Untitled Note',
        effectiveTenantId,
        currentNote.userId
      );

      setSharingOrganization(org);
      setShowSharingModal(true);
    } catch (error) {
      log.error('Error creating sharing organization', { error, noteId: currentNote._id });
      toast({
        title: 'Sharing Error',
        description: 'Failed to initialize sharing. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreatingSharingOrg(false);
    }
  };

  const handleSharingUpdated = () => {
    onSharingUpdated?.();
    toast({
      title: 'Sharing Updated',
      description: 'Note sharing settings have been updated.',
    });
  };

  return (
    <>
      {currentNote?.sharedVia ? (
        <SharedByBadge
          ownerName={currentNote.sharedVia.ownerEmail || currentNote.userId || 'Unknown User'}
        />
      ) : (
        <button
          onClick={handleShareNote}
          disabled={isCreatingSharingOrg}
          className="text-muted-foreground hover:bg-accent rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          title="Share Note"
        >
          {isCreatingSharingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share className="h-4 w-4" />}
        </button>
      )}

      {showSharingModal && sharingOrganization && currentNote && currentNote._id && (
        <NoteSharingModal
          isOpen={showSharingModal}
          onClose={() => setShowSharingModal(false)}
          organization={sharingOrganization}
          tenantId={currentNote.tenantId}
          currentUserId={currentNote.userId}
          resourceId={currentNote._id}
          resourceTitle={currentNote.title || 'Untitled Note'}
          onSharingUpdated={handleSharingUpdated}
        />
      )}
    </>
  );
}
