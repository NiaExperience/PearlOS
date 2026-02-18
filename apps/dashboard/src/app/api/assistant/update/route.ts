import { AssistantActions } from '@nia/prism/core/actions';
import { NextRequest, NextResponse } from 'next/server';

import { coerceFeatureKeyList, featureListsEqual } from '@dashboard/lib/assistant-feature-sync';

// POST /api/assistant/update
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const { assistantId, tenantId, ...rest } = body || {};

    if (!assistantId) {
      return NextResponse.json({ error: 'assistantId is required' }, { status: 400 });
    }

    const existingAssistant = await AssistantActions.getAssistantById(assistantId);
    if (!existingAssistant) {
      return NextResponse.json({ error: 'Assistant not found' }, { status: 404 });
    }

    const allowedFields = [
      'name',
      'persona_name',
      'special_instructions',
      'firstMessage',
      'firstMessageMode',
      'hipaaEnabled',
      'model',
      'voice',
      // Messaging / server config
      'serverUrl',
      'serverSecret',
      'clientMessages',
      'serverMessages',
      'endCallMessage',
      // Phone / content config
      'assistantPhoneNumber',
      'contentTypes',
      'ui',
      'is_template',
      'tenantId',
      // Access / Features controls
      'desktopMode',
      'supportedFeatures',
      'startFullScreen',
      // Personality selection
      'personalityId',
      // 'botPersonalityId',
      'allowedPersonalities',
      'modePersonalityVoiceConfig',
      'dailyCallPersonalityVoiceConfig',
      'generationModelConfig'
    ];
    const updatePayload: Record<string, unknown> = {};
    for (const key of Object.keys(rest)) {
      if (allowedFields.includes(key)) {
        updatePayload[key] = rest[key];
      }
    }

    const requestedSupported = Array.isArray(updatePayload.supportedFeatures)
      ? updatePayload.supportedFeatures
      : Array.isArray((existingAssistant as unknown as { supportedFeatures?: unknown }).supportedFeatures)
        ? (existingAssistant as unknown as { supportedFeatures: unknown[] }).supportedFeatures
        : [];
    let normalizedSupported = coerceFeatureKeyList(requestedSupported);
    let shouldWriteSupportedFeatures = Array.isArray(updatePayload.supportedFeatures)
      || Object.prototype.hasOwnProperty.call(rest, 'allowAnonymousLogin');

    if (Object.prototype.hasOwnProperty.call(rest, 'allowAnonymousLogin')) {
      const legacyAllow = Boolean(rest.allowAnonymousLogin);
      updatePayload.allowAnonymousLogin = rest.allowAnonymousLogin;
      const nextSet = new Set(normalizedSupported);
      if (legacyAllow) {
        nextSet.add('guestLogin');
      } else {
        nextSet.delete('guestLogin');
      }
      const guestAdjusted = coerceFeatureKeyList(Array.from(nextSet));
      if (!featureListsEqual(guestAdjusted, normalizedSupported)) {
        normalizedSupported = guestAdjusted;
        shouldWriteSupportedFeatures = true;
      }
    }

    if (shouldWriteSupportedFeatures) {
      updatePayload.supportedFeatures = normalizedSupported;
    }
    // tenantId reassignment: allow explicit empty string to unassign, treat as undefined removal
    if (tenantId !== undefined) {
      updatePayload.tenantId = tenantId || '';
    }
    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 });
    }

    // Add business logic here.
    const rawName = typeof (updatePayload as Record<string, unknown>)["name"] === 'string'
      ? ((updatePayload as Record<string, unknown>)["name"] as string)
      : undefined;
    if (rawName && rawName.trim().length > 0) {
      let subDomain = rawName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 63);
      // Preserve "pearlos" - if generated subDomain would be "pearl", change it to "pearlos"
      if (subDomain === 'pearl') {
        subDomain = 'pearlos';
      }
      (updatePayload as Record<string, unknown>)["subDomain"] = subDomain;
    }

    // Migrate allowedPersonalities from UUID keys to composite keys
    if (updatePayload.allowedPersonalities && typeof updatePayload.allowedPersonalities === 'object' && !Array.isArray(updatePayload.allowedPersonalities)) {
      const allowedPersonalities = updatePayload.allowedPersonalities as Record<string, {
        personalityId?: string;
        name?: string;
        voiceId?: string;
        voiceProvider?: string;
        voiceParameters?: unknown;
      }>;
      
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const migrated: Record<string, unknown> = {};
      
      for (const [key, config] of Object.entries(allowedPersonalities)) {
        if (uuidRegex.test(key)) {
          // Old UUID format - migrate to composite key
          const name = config.name || 'unnamed';
          const provider = config.voiceProvider || 'unknown';
          const voiceId = config.voiceId || 'no-voice';
          const newKey = `${name}-${provider}-${voiceId}`;
          migrated[newKey] = config;
        } else {
          // Already using composite key format
          migrated[key] = config;
        }
      }
      
      updatePayload.allowedPersonalities = migrated;
    }

    const updated = await AssistantActions.updateAssistant(assistantId, updatePayload);
    if (!updated) {
      return NextResponse.json({ error: 'Failed to update assistant' }, { status: 500 });
    }
    return NextResponse.json({ success: true, assistant: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
