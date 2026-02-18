import { z } from 'zod';

export const BlockType_User = 'User';

// Define message schema if needed
export interface MessageType {
    content: string;
    timestamp?: string;
    type?: string;
};

// Define event schema if needed
export interface EventType {
    eventType: string;
    timestamp?: string;
    details?: string[];
};

// Define chat schema if needed
export interface ChatType {
    message: string;
    timestamp?: string;
    sender: string;
    metadata?: Record<string, string>;
};

export interface IUserMessageStore {
    messages?: MessageType[];
    eventHistory?: EventType[];
    chatHistory?: ChatType[];
};

export const UserMessageStoreSchema = z.object({
    messages: z.array(
        z.object({
            content: z.string(),
            timestamp: z.string().optional(),
            type: z.string().optional(),
        })
    ).optional(),
    eventHistory: z.array(
        z.object({
            eventType: z.string(),
            timestamp: z.string().optional(),
            details: z.array(z.string()).optional(),
        })
    ).optional(),
    chatHistory: z.array(
        z.object({
            message: z.string(),
            timestamp: z.string().optional(),
            sender: z.string(),
        })
    ).optional(),
});

export interface IUser extends IUserMessageStore {
    _id?: string;
    name: string;

    email?: string;
    emailVerified?: string | Date | null;
    image?: string;
    metadata?: Record<string, string>;
    password_hash?: string; // Optional for OAuth
    phone_number?: string;
    status?: string; // unused?
}

export const UserSchema = UserMessageStoreSchema.extend({
    _id: z.string().optional(),
    name: z.string(),
    phone_number: z.string().optional(),
    email: z.string().optional().transform(val => val ? val.toLowerCase() : val),
    interests: z.array(z.string()).optional(),
    social_styles: z.string().optional(),
    status: z.string().optional(),
    password_hash: z.string().optional(),
    image: z.string().optional(),
    emailVerified: z.union([z.string(), z.date()]).optional(),
    metadata: z.record(z.any()).optional(),
});