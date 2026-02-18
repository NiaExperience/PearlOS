import { getAssistantLoginFeatureState } from '@nia/prism/core';
import { AssistantActions } from '@nia/prism/core/actions';
import { NextRequest, NextResponse } from 'next/server';

import {
  coerceFeatureKeyList,
} from '@interface/lib/assistant-feature-sync';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_assistant_meta]');

// Public metadata endpoint: returns minimal assistant access/features hints
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agent = searchParams.get('agent') || searchParams.get('subDomain') || undefined;
    if (!agent) {
      return NextResponse.json({ error: 'agent is required' }, { status: 400 });
    }
  const assistant = await AssistantActions.getAssistantBySubDomain(agent);
    if (!assistant) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    // Only expose safe fields
    const rawAllowAnon = (assistant as unknown as { allowAnonymousLogin?: boolean }).allowAnonymousLogin;
    const supportedRaw = (assistant as unknown as { supportedFeatures?: unknown }).supportedFeatures;
    const { supportedList, guestAllowed } = getAssistantLoginFeatureState({
      allowAnonymousLogin: rawAllowAnon,
      supportedFeatures: supportedRaw,
    });

    let normalizedSupported = coerceFeatureKeyList(supportedList);
    if (typeof rawAllowAnon === 'boolean') {
      const hasGuestLoginFlag = normalizedSupported.includes('guestLogin');
      if (rawAllowAnon && !hasGuestLoginFlag) {
        normalizedSupported.push('guestLogin');
      }
      if (!rawAllowAnon && hasGuestLoginFlag) {
        const idx = normalizedSupported.indexOf('guestLogin');
        if (idx >= 0) {
          normalizedSupported.splice(idx, 1);
        }
      }
    }
    normalizedSupported = coerceFeatureKeyList(normalizedSupported);
    return NextResponse.json({
      name: assistant.name,
      subDomain: assistant.subDomain,
      allowAnonymousLogin: guestAllowed,
      supportedFeatures: normalizedSupported,
    });
  } catch (e) {
    log.error('assistant/meta error', { error: e, agent: req.url });
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
