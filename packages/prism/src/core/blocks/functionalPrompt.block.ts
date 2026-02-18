import z from 'zod';

export const BlockType_FunctionalPrompt = 'FunctionalPrompt';

export interface IFunctionalPromptHistoryEntry {
    userId: string;
    delta: string;
    modifiedAt: string;
}

export interface IFunctionalPrompt {
    _id?: string;
    featureKey: string;
    promptContent: string;
    lastModifiedByUserId?: string;
    history?: IFunctionalPromptHistoryEntry[];
    createdAt?: string;
    updatedAt?: string;
}

export const FunctionalPromptHistoryEntrySchema = z.object({
    userId: z.string(),
    delta: z.string(),
    modifiedAt: z.string()
});

export const FunctionalPromptSchema = z.object({
    _id: z.string().uuid().optional(),
    featureKey: z.string(),
    promptContent: z.string(),
    lastModifiedByUserId: z.string().optional(),
    history: z.array(FunctionalPromptHistoryEntrySchema).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
});
