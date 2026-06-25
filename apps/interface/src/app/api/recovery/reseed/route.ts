import { NextRequest, NextResponse } from 'next/server';
import { AssistantActions, TenantActions, PersonalityActions } from '@nia/prism/core/actions';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

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
    'assistantSelfClose',
    'passwordLogin', 'guestLogin', 'onboarding', 'calculator',
    'youtube', 'soundtrack', 'terminal', 'openclawBridge', 'enhancedBrowser',
    'news', 'weather', 'wonderCanvas', 'browserAutomation', 'sprites', 'vision',
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

function cleanAssistantName(value: unknown): string | null {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : 'pearlos';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return null;
  return raw.toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const assistantName = cleanAssistantName(body?.assistantName);
    if (!assistantName) {
      return NextResponse.json({ success: false, error: 'invalid_assistant_name' }, { status: 400 });
    }
    const requestedTenantId = body?.tenantId || body?.tenant_id;
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId,
      minimumRole: TenantRole.ADMIN,
    });
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;

    log.info('Recovery reseed requested', {
      assistantName,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
    });

    // Check if assistant already exists
    let assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
    
    if (assistant) {
      if (assistant.tenantId && assistant.tenantId !== actor.tenantId) {
        const assistantTenantActor = await resolveInterfaceActorContext({
          requestedTenantId: assistant.tenantId,
          minimumRole: TenantRole.ADMIN,
        });
        if (!assistantTenantActor.ok) return assistantTenantActor.response;
      }
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
      await PersonalityActions.createPersonality(tenantId, {
        key: 'pearl-default',
        name: 'Pearl',
        description: 'Default personality for Pearl - friendly, helpful, conversational',
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
