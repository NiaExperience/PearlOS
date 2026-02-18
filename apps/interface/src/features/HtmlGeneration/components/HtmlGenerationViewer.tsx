'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';

import AssistantWrapper from '@interface/components/assistant-canvas';
import { SUPERADMIN_USER_ID } from '@interface/constants/superadmin';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { HtmlContentViewer } from '@interface/features/HtmlGeneration/components/HtmlContentViewer';
// Import the plain type directly to avoid pulling in server action exports from the feature barrel
import type { HtmlContent } from '@interface/features/HtmlGeneration/types/html-generation-types';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { useToast } from '@interface/hooks/use-toast';
import { getClientLogger } from '@interface/lib/client-logger';

interface HtmlGenerationViewerProps {
  htmlGeneration: HtmlContent;
  onClose: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  isAdmin?: boolean; // Optional prop to override admin status
  assistantConfig?: any;
}

export function HtmlGenerationViewer({
  htmlGeneration,
  onClose,
  isFullscreen = false,
  onToggleFullscreen,
  assistantConfig,
}: HtmlGenerationViewerProps) {
  const log = useMemo(() => getClientLogger('[html-generation.viewer]'), []);
  const [current, setCurrent] = useState(htmlGeneration);
  const { toast } = useToast();
  const { data: session } = useResilientSession();
  const isAdmin = !!session?.user?.id && session.user.id === SUPERADMIN_USER_ID;
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
  const [isInIframe, setIsInIframe] = useState(false);
  const { callStatus: voiceCallStatus, roomUrl: voiceRoomUrl } = useVoiceSessionContext();
  const sessionId = (session as any)?.sessionId || (session as any)?.user?.sessionId;
  const sessionUserId = (session as any)?.user?.id;
  const sessionUserName = (session as any)?.user?.name || (session as any)?.user?.username;

  const postActiveApplet = useCallback(async (appletId: string | null | undefined, source: string) => {
    if (!appletId) return;
    if (voiceCallStatus !== 'active' || !voiceRoomUrl) {
      log.debug('Voice session not active; not posting active applet', { voiceCallStatus, voiceRoomUrl });
      return;
    }
    try {
      await fetch('/api/room/active-applet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId || '',
          'x-user-id': sessionUserId || '',
          'x-user-name': sessionUserName || '',
        },
        body: JSON.stringify({
          room_url: voiceRoomUrl,
          applet_id: appletId,
          owner: session?.user?.id,
          session_id: sessionId,
          owner_name: sessionUserName,
        }),
      });
      log.info('Posted active applet for voice session', { appletId, source, roomUrl: voiceRoomUrl });
    } catch (err) {
      log.warn('Failed to post active applet for voice session', { err, appletId, roomUrl: voiceRoomUrl });
    }
  }, [log, session?.user?.id, sessionId, sessionUserId, sessionUserName, voiceCallStatus, voiceRoomUrl]);

  useEffect(() => {
    setIsInIframe(window.self !== window.top);
  }, []);

  useEffect(() => {
    const currentId = (current as any).page_id || (current as any)._id || (current as any).id;
    postActiveApplet(currentId, 'voice-session-active');
  }, [current, postActiveApplet, voiceCallStatus, voiceRoomUrl, log]);

  useEffect(() => {
    const initialId = (current as any).page_id || (current as any)._id || (current as any).id;
    postActiveApplet(initialId, 'initial-load');
  }, [current, postActiveApplet]);

  const handleAppletChange = useCallback(async (newId: string) => {
    try {
      // Build query params including agent and userId context
      const qp = new URLSearchParams({ id: newId });
      if (isAdmin && selectedUserId) qp.set('userId', selectedUserId);
      else if (session?.user?.id) qp.set('userId', session.user.id);
      // Note: HtmlContent type has no assistantName; rely on session.user?.assistantName if present
      const possibleAgent = (session as any)?.user?.assistantName;
      if (possibleAgent) qp.set('agent', possibleAgent);
      const res = await fetch(`/api/get-html-content?${qp.toString()}`);
      if (!res.ok) throw new Error('Failed to load applet');
      const json = await res.json();
      if (json?.success && json?.data) {
        setCurrent(json.data);
        const newAppletId = json.data?.page_id || json.data?._id || json.data?.id || newId;
        postActiveApplet(newAppletId, 'applet-change');
      }
    } catch (e: any) {
      const msg = e?.message || 'Failed to switch applet';
      log.warn('Failed to switch applet', { err: e, newId });
      toast({
        title: 'Applet Load Error',
        description: msg,
        variant: 'destructive',
      } as any);
    }
  }, [isAdmin, selectedUserId, session, toast]);

  return (
    <>
      <HtmlContentViewer
        // title={current.title}
        htmlContent={current.htmlContent}
        contentType={current.contentType}
        onClose={onClose}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        enableAppletSelector
        appletId={(current as any).page_id || (current as any)._id || (current as any).id}
        appletTitle={current.title}
        onRequestAppletChange={handleAppletChange}
        isAdmin={isAdmin}
        selectedUserId={selectedUserId}
        onSelectUser={id => {
          setSelectedUserId(id);
          // After selecting a user, refetch applets by triggering effect in child; selection of specific applet is deferred until user picks
        }}
              currentUserId={session?.user?.id}
              currentUserName={session?.user?.name || (session?.user as any)?.username || undefined}
        aiProvider={(current as any)?.metadata?.aiProvider}
        aiModel={(current as any)?.metadata?.aiModel}
        opId={(current as any)?.metadata?.opId}
        diagnostics={
          Array.isArray((current as any)?.metadata?.diagnostics)
            ? (current as any).metadata.diagnostics
            : undefined
        }
        sharedVia={current.sharedVia}
      />
      {assistantConfig && !isInIframe && (
        <AssistantWrapper
          {...assistantConfig}
          startFullScreen={false}
          clientLanguage="en"
        />
      )}
    </>
  );
}
