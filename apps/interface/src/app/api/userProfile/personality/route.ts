import type { IPersonalityVoiceConfig } from '@nia/prism/core';
import { createOrUpdateUserProfile } from '@nia/prism/core/actions/userProfile-actions';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_user_profile_personality]');

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(interfaceAuthOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { personalityVoiceConfig } = await request.json() as { 
      personalityVoiceConfig: IPersonalityVoiceConfig 
    };
    
    // Validate required fields
    if (!personalityVoiceConfig?.personalityId || !personalityVoiceConfig?.voiceId) {
      return NextResponse.json(
        { error: 'Invalid personality config - personalityId and voiceId required' }, 
        { status: 400 }
      );
    }

    // Store as top-level personalityVoiceConfig field
    const result = await createOrUpdateUserProfile({
      email: session.user.email,
      personalityVoiceConfig: {
        ...personalityVoiceConfig,
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
