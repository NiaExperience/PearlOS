import type { IPersonalityVoiceConfig } from '@nia/prism/core';
import { createOrUpdateUserProfile } from '@nia/prism/core/actions/userProfile-actions';
import { getPersonalityById } from '@nia/prism/core/actions/personality.actions';
import { NextRequest, NextResponse } from 'next/server';

import { getLogger } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('[api_user_profile_personality]');

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      tenantId?: string;
      tenant_id?: string;
      personalityVoiceConfig: IPersonalityVoiceConfig;
    };
    const { personalityVoiceConfig } = body;
    
    // Validate required fields
    if (
      !personalityVoiceConfig?.personalityId ||
      !personalityVoiceConfig?.name ||
      !personalityVoiceConfig?.voiceId ||
      !personalityVoiceConfig?.voiceProvider
    ) {
      return NextResponse.json(
        { error: 'Invalid personality config - personalityId, name, voiceId, and voiceProvider required' },
        { status: 400 }
      );
    }

    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: body.tenantId ?? body.tenant_id,
    });
    if (!actorResult.ok) return actorResult.response;

    const { tenantId, userId, userEmail } = actorResult.actor;
    const personality = await getPersonalityById(personalityVoiceConfig.personalityId, tenantId);
    if (!personality) {
      return NextResponse.json({ error: 'personality_forbidden' }, { status: 403 });
    }

    const result = await createOrUpdateUserProfile({
      email: userEmail,
      userId,
      personalityVoiceConfig: {
        ...personalityVoiceConfig,
        name: personality.name || personalityVoiceConfig.name,
        lastUpdated: new Date().toISOString()
      }
    }, false);

    if (!result) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('Error updating personality config', { error });
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
