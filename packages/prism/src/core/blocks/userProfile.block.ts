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

export interface ISocialLinks {
    twitter?: string;
    bluesky?: string;
    github?: string;
    website?: string;
}

export interface IPublicPersona {
    displayName?: string;
    bio?: string;
    interests?: string[];
    socialLinks?: ISocialLinks;
    avatarUrl?: string;
    location?: string;
    profession?: string;
    /** Whether this persona is visible/shared. Defaults to false. */
    isPublic?: boolean;
}

export interface IReminder {
    text: string;
    createdAt: string; // ISO timestamp
    dueDate?: string; // ISO timestamp
}

export interface IPrivateMemory {
    personalNotes?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    preferences?: Record<string, any>;
    reminders?: IReminder[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sensitiveData?: Record<string, any>;
    /** How the user prefers to interact with Pearl. */
    relationshipContext?: string;
}

export interface IUserProfile {
    _id?: string;
    first_name: string;
    email: string;
    userId?: string;
    onboardingComplete?: boolean;
    onboardingState?: IOnboardingState;
    overlayDismissed?: boolean;
    publicPersona?: IPublicPersona;
    privateMemory?: IPrivateMemory;
    sessionHistory?: ISessionHistoryEntry[];
    personalityVoiceConfig?: IPersonalityVoiceConfig;
    lastConversationSummary?: IConversationSummary;
    /**
     * @deprecated Use publicPersona / privateMemory instead. Kept on the type so
     * legacy records still type-check during read-time migration.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>;
}

export interface IOnboardingRequiredActions {
    profileUpdated?: boolean;
    welcomeNoteCreated?: boolean;
}

export interface IOnboardingState {
    currentBeat?: number;
    completedBeats?: string[];
    requiredActions?: IOnboardingRequiredActions;
    source?: 'voice' | 'text' | string;
    promptFeatureKey?: string;
    updatedAt?: string;
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

export const SocialLinksSchema = z.object({
    twitter: z.string().optional(),
    bluesky: z.string().optional(),
    github: z.string().optional(),
    website: z.string().optional()
});

export const PublicPersonaSchema = z.object({
    displayName: z.string().optional(),
    bio: z.string().optional(),
    interests: z.array(z.string()).optional(),
    socialLinks: SocialLinksSchema.optional(),
    avatarUrl: z.string().optional(),
    location: z.string().optional(),
    profession: z.string().optional(),
    isPublic: z.boolean().optional()
});

export const ReminderSchema = z.object({
    text: z.string(),
    createdAt: z.string(),
    dueDate: z.string().optional()
});

export const PrivateMemorySchema = z.object({
    personalNotes: z.string().optional(),
    preferences: z.record(z.any()).optional(),
    reminders: z.array(ReminderSchema).optional(),
    sensitiveData: z.record(z.any()).optional(),
    relationshipContext: z.string().optional()
});

export const OnboardingRequiredActionsSchema = z.object({
    profileUpdated: z.boolean().optional(),
    welcomeNoteCreated: z.boolean().optional()
});

export const OnboardingStateSchema = z.object({
    currentBeat: z.number().optional(),
    completedBeats: z.array(z.string()).optional(),
    requiredActions: OnboardingRequiredActionsSchema.optional(),
    source: z.string().optional(),
    promptFeatureKey: z.string().optional(),
    updatedAt: z.string().optional()
});

export const PersonalitySchema = z.object({
    _id: z.string().uuid().optional(),
    first_name: z.string(),
    email: z.string(),
    userId: z.string().optional(),
    onboardingComplete: z.boolean().optional(),
    onboardingState: OnboardingStateSchema.optional(),
    overlayDismissed: z.boolean().optional(),
    publicPersona: PublicPersonaSchema.optional(),
    privateMemory: PrivateMemorySchema.optional(),
    sessionHistory: z.array(SessionHistoryEntrySchema).optional(),
    personalityVoiceConfig: PersonalityVoiceConfigSchema.optional(),
    lastConversationSummary: ConversationSummarySchema.optional()
});
