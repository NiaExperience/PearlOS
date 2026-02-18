'use client';

import React from 'react';

import BrowserWindow from '@interface/components/browser-window';
import { useUI } from '@interface/contexts/ui-context';
import type { VoiceParametersInput } from '@interface/lib/voice/kokoro';

type VoiceParameters = VoiceParametersInput & {
  maxCallDuration?: number;
  participantLeftTimeout?: number;
  participantAbsentTimeout?: number;
  enableRecording?: boolean;
  enableTranscription?: boolean;
  applyGreenscreen?: boolean;
};

interface BrowserContainerWrapperProps {
  assistantName: string;
  voiceId: string;
  voiceProvider?: string;
  voiceParameters?: VoiceParameters;
  tenantId: string;
  supportedFeatures: string[];
  personalityId: string;
  persona: string;
}

const BrowserContainerWrapper: React.FC<BrowserContainerWrapperProps> = ({ assistantName, voiceId, voiceProvider = '11labs',voiceParameters, personalityId, tenantId, supportedFeatures, persona }) => {
  // BrowserWindow now handles its own container styling
  // No wrapper div needed - it was creating duplicate containers and ghost overlays
  return (
    <BrowserWindow assistantName={assistantName} tenantId={tenantId} supportedFeatures={supportedFeatures} voiceId={voiceId} voiceProvider={voiceProvider} personalityId={personalityId} voiceParameters={voiceParameters} persona={persona}/>
  );
};

export default BrowserContainerWrapper;
