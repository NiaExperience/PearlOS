import { z } from 'zod';

export const BlockType_Tool = 'Tool';

export enum ToolType {
    FUNCTION = 'function',
    OUTPUT = 'output',
    BASH = 'bash',
    COMPUTER = 'computer',
    TEXT_EDITOR = 'textEditor'
}

export enum ToolBaseType {
    PHOTOS = 'photos',
    MAP = 'map'
}

export enum MessageRole {
    USER = 'user',
    ASSISTANT = 'assistant',
    SYSTEM = 'system',
    TOOL = 'tool',
    FUNCTION = 'function'
}

export enum MessageType {
    TEXT = 'text',
    IMAGE = 'image',
    AUDIO = 'audio',
    VIDEO = 'video'
}

export interface ITool {
    _id?: string;
    type: ToolType;
    baseType?: ToolBaseType;
    async?: boolean;
    name?: string;
    description?: string;
    userId?: string;
    function?: {
        name?: string;
        strict?: boolean;
        description?: string;
        parameters?: {
            type: string;
            properties: Record<string, { type: string; description?: string }>;
            required: string[];
        };
    };
    requestMessages?: {
        start?: {
            type: MessageType;
            content: string;
            role?: MessageRole;
        };
        delayed?: {
            type: MessageType;
            content: string;
            role?: MessageRole;
            timingMilliseconds?: number;
        };
        completed?: {
            type: MessageType;
            content: string;
            role?: MessageRole;
        };
        failed?: {
            type: MessageType;
            content: string;
            role?: MessageRole;
        };
    };
    server?: {
        url?: string;
        timeoutSeconds?: string;
        secret?: string;
        headers?: Record<string, string>;
    };
}

export const ToolSchema = z.object({
    _id: z.string().optional(),
    type: z.nativeEnum(ToolType).default(ToolType.FUNCTION),
    baseType: z.nativeEnum(ToolBaseType).optional(),
    async: z.boolean().default(false),
    name: z.string().optional(),
    description: z.string().optional(),
    userId: z.string().optional(),
    function: z.object({
        name: z.string().optional(),
        strict: z.boolean().optional(),
        description: z.string().optional(),
        parameters: z.object({
            type: z.string().default('object'),
            properties: z.record(z.object({
                type: z.string().optional(),
                description: z.string().optional()
            })).optional(),
            required: z.array(z.string()).optional()
        }).optional()
    }).optional(),
    requestMessages: z.object({
        start: z.object({
            type: z.nativeEnum(MessageType).optional(),
            content: z.string().optional(),
            role: z.nativeEnum(MessageRole).optional()
        }).optional(),
        delayed: z.object({
            type: z.nativeEnum(MessageType).optional(),
            content: z.string().optional(),
            role: z.nativeEnum(MessageRole).optional(),
            timingMilliseconds: z.number().optional()
        }).optional(),
        completed: z.object({
            type: z.nativeEnum(MessageType).optional(),
            content: z.string().optional(),
            role: z.nativeEnum(MessageRole).optional()
        }).optional(),
        failed: z.object({
            type: z.nativeEnum(MessageType).optional(),
            content: z.string().optional(),
            role: z.nativeEnum(MessageRole).optional()
        }).optional()
    }).optional(),
    server: z.object({
        url: z.string().optional(),
        timeoutSeconds: z.string().optional(),
        secret: z.string().optional(),
        headers: z.record(z.string()).optional()
    }).optional()
});
