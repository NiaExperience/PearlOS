import { NextRequest, NextResponse } from 'next/server';
import { AssistantActions, TenantActions, PersonalityActions } from '@nia/prism/core/actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('recovery-reseed');

const DEFAULT_ASSISTANT_CONFIG = {
  name: 'Pearl',
  subDomain: 'pearlos',
  firstMessage: "Hey there! I'm Pearl, your AI companion. How can I help you today?",
  allowAnonymousLogin: true,
  desktopMode: 'home',
  model: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    systemPrompt: `You are Pearl, a helpful and friendly AI assistant built into the Nia Universal platform.
You are warm, approachable, and knowledgeable. You help users with their questions and tasks.
Keep responses concise but helpful. Use a friendly, conversational tone.`,
  },
  supportedFeatures: [
    'notes', 'htmlContent', 'miniBrowser', 'dailyCall', 'avatar',
    'passwordLogin', 'guestLogin', 'onboarding', 'calculator',
    'youtube', 'soundtrack', 'terminal', 'openclawBridge', 'enhancedBrowser',
  ],
  voiceProvider: 'pipecat',
  modePersonalityVoiceConfig: {
    default: {
      personaName: 'Pearl',
      personalityName: 'Pearl',
      voice: { provider: 'pocket', voiceId: 'azelma', speed: 1.0, model: 'pocket-v1' },
    },
    home: {
      personaName: 'Pearl',
      personalityName: 'Pearl',
      voice: { provider: 'pocket', voiceId: 'azelma', speed: 1.0, model: 'pocket-v1' },
    },
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const assistantName = body.assistantName || 'pearlos';

    log.info('Recovery reseed requested', { assistantName });

    // Check if assistant already exists
    let assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
    
    if (assistant) {
      log.info('Assistant already exists, skipping creation', { assistantName, id: assistant._id });
      return NextResponse.json({ success: true, message: 'Assistant already exists', id: assistant._id });
    }

    // Create assistant
    const assistantData = {
      name: assistantName === 'pearlos' ? 'Pearl' : assistantName.charAt(0).toUpperCase() + assistantName.slice(1),
      subDomain: assistantName,
    };

    const tenantId = await TenantActions.findOrCreateTenantForAssistant(assistantData, interfaceAuthOptions);
    assistant = await AssistantActions.createAssistant({ ...assistantData, tenantId });

    // Apply full configuration
    const updateData = {
      ...assistant,
      ...DEFAULT_ASSISTANT_CONFIG,
      name: assistantData.name,
      subDomain: assistantName,
      tenantId,
    };
    await AssistantActions.updateAssistant(assistant._id!, updateData);

    // Try to create default personality
    try {
      await PersonalityActions.createPersonality({
        key: 'pearl-default',
        name: 'Pearl',
        description: 'Default personality for Pearl - friendly, helpful, conversational',
        tenantId,
        primaryPrompt: `You are Pearl, an AI assistant with a warm and friendly personality.
Core traits: Helpful, knowledgeable, conversational, patient, concise but thorough.
Use natural language, be encouraging, ask clarifying questions when needed.`,
        variables: ['username', 'roomName'],
        version: 1,
      } as any);
    } catch (personalityError) {
      log.warn('Could not create personality (may already exist)', { error: personalityError });
    }

    log.info('Recovery reseed complete', { assistantName, id: assistant._id });
    return NextResponse.json({ success: true, message: 'Assistant created successfully', id: assistant._id });
  } catch (error: any) {
    log.error('Recovery reseed failed', { error: error.message });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
