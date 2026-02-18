// This duplicate BrowserContainerWrapper (layout variant) has been deprecated.
// Use the canonical version in BrowserContainerWrapper.tsx which integrates UI context sizing.
// Keeping a minimal stub export to avoid breaking any pending imports; will log a warning in dev.
'use client';
import React from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

import CanonicalBrowserContainerWrapper from './BrowserContainerWrapper';

const log = getClientLogger('BrowserAutomation');

const DeprecatedBrowserContainerWrapper: React.FC<{ assistantName?: string, tenantId?: string, supportedFeatures: string[] } & Record<string, unknown>> = (props) => {
  if (process.env.NODE_ENV === 'development') {
    log.warn('Deprecated browser-container-wrapper.tsx used. Please import BrowserContainerWrapper.tsx instead.');
  }
  // Fallback assistantName
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <CanonicalBrowserContainerWrapper supportedFeatures={props.supportedFeatures} assistantName={(props as any).assistantName || 'nia-ambassador'} tenantId={(props as any).tenantId || 'default-tenant-id'} voiceId='P7x743VjyZEOihNNygQ9' voiceProvider='11labs' personalityId='' persona='Pearl' />;
};

export { DeprecatedBrowserContainerWrapper as BrowserContainerWrapper };
export default DeprecatedBrowserContainerWrapper;
