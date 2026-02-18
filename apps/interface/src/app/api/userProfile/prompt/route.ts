import { composeUserPrompt as composeUserPromptCore } from '@nia/features/featurePrompts';
import { UserProfileActions } from '@nia/prism/core/actions';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, User } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_user_profile_prompt]');


export async function composeUserPrompt(
  user: User,
  assistantName: string
): Promise<string> {
  try {
    // Fetch user profile to prioritize first_name
    let profileFirstName = '';
    let userProfileMetadata: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sessionHistory: any = [];
    try {
      let res = null;
      res = await UserProfileActions.findByUser(user.id || undefined, user.email || undefined);
      if (res) {
        profileFirstName = res.userProfile?.first_name || '';
        userProfileMetadata = res.userProfile?.metadata as Record<string, unknown>;
        sessionHistory = res.userProfile?.sessionHistory || [];
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('Failed to load userProfile metadata for API; continuing with defaults', { message: msg });
    }

    // Prioritize profile first_name over session user.name
    let userName = '';
    let userNameSource = '';
    if (profileFirstName) {
      userName = profileFirstName;
      userNameSource = 'userProfile.first_name';
    } else if (user.name) {
      userName = user.name;
      userNameSource = 'session.user.name';
    } else {
      userName = '';
      userNameSource = 'empty (no name available)';
    }
    
    log.info('User name resolution', { userName, userNameSource, assistantName });

    // Convert metadata values to strings for prompt context
    const toStr = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return val;
      try {
        if (typeof val === 'object') return JSON.stringify(val);
      } catch {
        // ignore JSON stringify errors
      }
      return String(val);
    };

    const userProfileForPrompt: Record<string, string> = Object.fromEntries(
      Object.entries(userProfileMetadata).map(([k, v]) => [k, toStr(v)])
    );

    // Compose the full user prompt
    const userPrompt = composeUserPromptCore({ 
      'username': userName, 
      'userProfile': userProfileForPrompt,
      'sessionHistory': sessionHistory 
    });

    log.info('API composed userPrompt', { assistantName, userName });
    
    return userPrompt;
  } catch (error) {
    log.error('Error composing user prompt', { error });
    // Fallback to basic prompt
    return `The user's name is "${user.name || 'User'}". You should refer to them by their first name.`;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(interfaceAuthOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get assistant name from query params
    const searchParams = request.nextUrl.searchParams;
    const assistantName = searchParams.get('assistantName');

    if (!assistantName) {
      return NextResponse.json({ error: 'Assistant name is required' }, { status: 400 });
    }

    // Compose the user prompt with full profile data
    const userPrompt = await composeUserPrompt(session.user, assistantName);

    return NextResponse.json({ userPrompt });
  } catch (error) {
    log.error('Error composing user prompt', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}