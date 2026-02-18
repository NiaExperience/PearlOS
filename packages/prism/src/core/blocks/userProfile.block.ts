import z from 'zod';
export const BlockType_UserProfile = 'UserProfile';

export interface ISessionHistoryRefId {
    type: string;
    id: string;
    description?: string;
}

export interface ISessionHistoryEntry {
    time: string; // ISO timestamp
    action: string;
    sessionId: string;
    refIds?: ISessionHistoryRefId[];
}

export interface IPersonalityVoiceConfig {
    personalityId: string;
    name: string;
    voiceId: string;
    voiceProvider: string;
    voiceParameters?: Record<string, any>;
    lastUpdated: string; // ISO timestamp
}

export interface IConversationSummary {
    summary: string; // The LLM-generated summary text
    sessionId: string; // Daily.co room or session identifier
    timestamp: string; // ISO timestamp of session end
    assistantName: string; // Which assistant was used
    participantCount?: number; // How many humans participated
    durationSeconds?: number; // Session length in seconds
}

export interface IUserProfile {
    _id?: string;
    first_name: string;
    email: string;
    userId?: string;
    onboardingComplete?: boolean;
    overlayDismissed?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>;
    sessionHistory?: ISessionHistoryEntry[];
    personalityVoiceConfig?: IPersonalityVoiceConfig;
    lastConversationSummary?: IConversationSummary;
}

export const SessionHistoryRefIdSchema = z.object({
    type: z.string(),
    id: z.string()
});

export const SessionHistoryEntrySchema = z.object({
    time: z.string(),
    action: z.string(),
    sessionId: z.string(),
    refIds: z.array(SessionHistoryRefIdSchema).optional()
});

export const PersonalityVoiceConfigSchema = z.object({
    personalityId: z.string(),
    name: z.string(),
    voiceId: z.string(),
    voiceProvider: z.string(),
    voiceParameters: z.record(z.any()).optional(),
    lastUpdated: z.string()
});

export const ConversationSummarySchema = z.object({
    summary: z.string(),
    sessionId: z.string(),
    timestamp: z.string(),
    assistantName: z.string(),
    participantCount: z.number().optional(),
    durationSeconds: z.number().optional()
});

export const PersonalitySchema = z.object({
    _id: z.string().uuid().optional(),
    first_name: z.string(),
    email: z.string(),
    userId: z.string().optional(),
    onboardingComplete: z.boolean().optional(),
    overlayDismissed: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
    sessionHistory: z.array(SessionHistoryEntrySchema).optional(),
    personalityVoiceConfig: PersonalityVoiceConfigSchema.optional(),
    lastConversationSummary: ConversationSummarySchema.optional()
});
