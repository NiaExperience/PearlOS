import z from 'zod';

export const BlockType_Personality = 'Personality';

export const PersonalityVariableValues = ['username','roomName','topic'] as const;
export type PersonalityVariable = typeof PersonalityVariableValues[number];

export interface IPersonalityEventResponse { text: string; }
export interface IPersonalityEventPrompt { event: string; response: IPersonalityEventResponse; }

export interface IPersonalityBeat {
  message: string;
  start_time: number; // seconds since call start
}

export interface IPersonalityHistoryEntry {
  userId: string;
  delta: string;
  modifiedAt: string;
}

export interface IPersonality {
  _id?: string;
  key?: string;
  name?: string;
  description?: string;
  primaryPrompt: string;
  variables?: PersonalityVariable[];
  beats?: IPersonalityBeat[];
  tenantId: string;
  version?: number;
  lastModifiedByUserId?: string;
  history?: IPersonalityHistoryEntry[];
  createdAt?: string;
  updatedAt?: string;
}
// NOTE, theabove interfaces are COPIED to packages/features/src/featurePrompts.ts

export const PersonalityHistoryEntrySchema = z.object({
  userId: z.string(),
  delta: z.string(),
  modifiedAt: z.string()
});

export const PersonalitySchema = z.object({
  _id: z.string().uuid().optional(),
  key: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  primaryPrompt: z.string(),
  variables: z.array(z.enum(PersonalityVariableValues)).optional(),
  beats: z.array(z.object({
    message: z.string(),
    start_time: z.number().min(0)
  })).optional(),
  tenantId: z.string(),
  version: z.number().optional(),
  lastModifiedByUserId: z.string().optional(),
  history: z.array(PersonalityHistoryEntrySchema).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type IPersonalityValidated = z.infer<typeof PersonalitySchema>;
