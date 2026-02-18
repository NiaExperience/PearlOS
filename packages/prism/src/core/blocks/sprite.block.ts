import z from 'zod';

export const BlockType_Sprite = 'Sprite';

/**
 * Voice provider options for Sprite TTS
 * POC uses Kokoro, future: support additional providers
 */
export const SpriteVoiceProviderValues = ['kokoro'] as const;
export type SpriteVoiceProvider = typeof SpriteVoiceProviderValues[number];

// ---------------------------------------------------------------------------
// Bot Configuration — Sprite Bot Framework
// ---------------------------------------------------------------------------

/** Bot archetype presets */
export const SpriteBotTypeValues = ['companion', 'assistant', 'game', 'custom'] as const;
export type SpriteBotType = typeof SpriteBotTypeValues[number];

/** Tool categories for the tool picker UI */
export const SpriteToolCategories = {
  media: ['bot_play_soundtrack', 'bot_stop_soundtrack', 'bot_youtube_search', 'bot_youtube_play'],
  notes: ['bot_create_note', 'bot_update_note', 'bot_read_note', 'bot_list_notes'],
  sprites: ['bot_summon_sprite'],
  system: ['bot_open_settings', 'bot_open_profile'],
  social: ['bot_share_note', 'bot_share_sprite'],
  experiences: ['bot_launch_experience', 'bot_list_experiences'],
} as const;

export type SpriteToolCategory = keyof typeof SpriteToolCategories;

/** A single behavior rule: trigger → action */
export interface ISpriteBehavior {
  id: string;
  trigger: string;   // natural-language trigger (e.g. "user says goodnight")
  action: string;    // natural-language action (e.g. "play lullaby soundtrack")
  enabled: boolean;
}

/** Full bot configuration stored on a Sprite */
export interface ISpriteBotConfig {
  botType: SpriteBotType;
  tools: string[];              // tool function names to whitelist
  systemPrompt: string;         // override/augment the sprite's personality
  greeting: string;             // custom first message when sprite activates
  behaviors: ISpriteBehavior[]; // trigger→action rules
}

// Zod schemas for validation

export const SpriteBehaviorSchema = z.object({
  id: z.string(),
  trigger: z.string(),
  action: z.string(),
  enabled: z.boolean().default(true),
});

export const SpriteBotConfigSchema = z.object({
  botType: z.enum(SpriteBotTypeValues).default('companion'),
  tools: z.array(z.string()).default([]),
  systemPrompt: z.string().default(''),
  greeting: z.string().default(''),
  behaviors: z.array(SpriteBehaviorSchema).default([]),
});

// ---------------------------------------------------------------------------
// Sprite Block
// ---------------------------------------------------------------------------

/**
 * Sprite: User-owned AI companion with embedded personality and voice configuration.
 * 
 * Sprites are summoned via natural language prompts, generating a pixelated GIF
 * character with a unique personality. When voice is active, the Sprite takes
 * over the conversation context using personality switching.
 */
export interface ISprite {
  _id?: string;
  parent_id: string;          // userId (owner)
  tenantId: string;
  
  // Identity
  name: string;
  description: string;
  originalRequest: string;    // User's original summon prompt
  
  // Visual — GIF stored as base64 for persistence across sessions
  gifData: string;            // Base64-encoded GIF binary
  gifMimeType: string;        // 'image/gif'
  
  // Personality
  primaryPrompt: string;
  
  // Voice (Kokoro for POC)
  voiceProvider: SpriteVoiceProvider;
  voiceId: string;
  voiceParameters?: Record<string, unknown>;
  
  // Bot Configuration (optional — sprites without botConfig behave as before)
  botConfig?: ISpriteBotConfig;
  
  // Memory (future: richer conversation summaries)
  lastConversationSummary?: string;
  lastConversationAt?: string;
  
  createdAt?: string;
  updatedAt?: string;
}

export const SpriteSchema = z.object({
  _id: z.string().uuid().optional(),
  parent_id: z.string(),
  tenantId: z.string(),
  
  // Identity
  name: z.string(),
  description: z.string(),
  originalRequest: z.string(),
  
  // Visual
  gifData: z.string(),
  gifMimeType: z.string(),
  
  // Personality
  primaryPrompt: z.string(),
  
  // Voice
  voiceProvider: z.enum(SpriteVoiceProviderValues),
  voiceId: z.string(),
  voiceParameters: z.record(z.unknown()).optional(),
  
  // Bot Configuration
  botConfig: SpriteBotConfigSchema.optional(),
  
  // Memory
  lastConversationSummary: z.string().optional(),
  lastConversationAt: z.string().optional(),
  
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ISpriteValidated = z.infer<typeof SpriteSchema>;
