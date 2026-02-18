'use server';

import { NextAuthOptions } from 'next-auth';

import { Prism } from '../../prism';
import { getSessionSafely } from '../auth';
import { ITool, ToolBaseType, BlockType_Tool } from '../blocks/tool.block';
import { getLogger } from '../logger';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';

const log = getLogger('prism:actions:tools');

// Update Tool Input Type
export type UpdateToolParams = Partial<ITool>;

/**
 * Creates a new tool in the database.
 *
 * @param toolData - The tool data to create the tool with.
 * @returns A promise that resolves to the created tool.
 * @throws Will throw an error if required fields are missing or if the user is not authenticated.
 */
export async function createTool(toolData: ITool, authOptions?: NextAuthOptions): Promise<ITool> {
    try {
        const prism = await Prism.getInstance();
        const session = await getSessionSafely(undefined, authOptions);
        if (!session || !session.user || !session.user.id) {
            throw new Error('Unauthorized');
        }

        const tool = {...toolData, userId: session.user.id};
        const created = await prism.create(BlockType_Tool, tool, 'any');
        if (!created || created.total === 0 || created.items.length === 0) {
            throw new Error('Failed to create tool');
        }
        return created.items[0] as unknown as ITool;
    } catch (error) {
        log.error('Error creating tool', { error });
        throw error;
    }
}

/**
 * Retrieves all tools for the authenticated user.
 *
 * @returns A promise that resolves to an array of tools.
 * @throws Will throw an error if the user is not authenticated.
 */
export async function getAllTools(userId: string): Promise<ITool[]> {
    try {
        const prism = await Prism.getInstance();
        const query: PrismContentQuery = {
            contentType: BlockType_Tool,
            tenantId: 'any',
            where: { parent_id: userId },
            orderBy: { createdAt: 'asc' as const },
        };
         // Use the query to fetch tools
        const result = await prism.query(query);
        return result.items as ITool[];
    } catch (error) {
        log.error('Error getting all tools', { userId, error });
        throw error;
    }
}

/**
 * Retrieves all tools for a specific user.
 *
 * @param userId - The ID of the user whose tools to retrieve.
 * @returns A promise that resolves to an array of tools.
 */
export async function getToolsForUser(userId: string): Promise<ITool[]> {
    try {
        const prism = await Prism.getInstance();
        const query: PrismContentQuery = {
            contentType: BlockType_Tool,
            tenantId: 'any',
            where: { parent_id: userId },
            orderBy: { createdAt: 'asc' as const },
        };
        const result = await prism.query(query);
        return result.items as ITool[];
    } catch (error) {
        log.error('Error getting tools for user', { userId, error });
        throw error;
    }
}

/**
 * Retrieves a tool for a specific user with a specific base type.
 *
 * @param userId - The ID of the user whose tool to retrieve.
 * @param baseType - The base type of the tool to retrieve.
 * @returns A promise that resolves to the tool, or null if not found.
 */
export async function getToolForUserWithBaseType(userId: string, baseType: ToolBaseType): Promise<ITool | null> {
    try {
        const prism = await Prism.getInstance();
        const query: PrismContentQuery = {
            contentType: BlockType_Tool,
            tenantId: 'any',
            where: { 
                parent_id: userId,
                indexer: { path: "baseType", equals: baseType }
            },
        };
        const result = await prism.query(query);
        if (!result.items || result.items.length === 0) return null;
        return result.items[0] as ITool;
    } catch (error) {
        log.error('Error getting tool for user with base type', { userId, baseType, error });
        throw error;
    }
}

/**
 * Retrieves tools by their IDs.
 *
 * @param toolIds - Array of tool IDs to retrieve.
 * @returns A promise that resolves to an array of tools.
 */
export async function getAllToolsForGivenIds(toolIds: string[], authOptions: NextAuthOptions): Promise<ITool[]> {
    try {
        const tools: ITool[] = [];
        
        for (const toolId of toolIds) {
            const tool = await getToolById(toolId, authOptions);
            if (tool) {
                tools.push(tool);
            }
        }
        
        return tools;
    } catch (error) {
        log.error('Error getting tools by IDs', { toolIds, error });
        throw error;
    }
}

/**
 * Retrieves a tool by its ID.
 *
 * @param toolId - The ID of the tool to retrieve.
 * @returns A promise that resolves to the tool, or null if not found.
 * @throws Will throw an error if the user is not authenticated or if the tool doesn't belong to the user.
 */
export async function getToolById(toolId: string, authOptions: NextAuthOptions): Promise<ITool | null> {
    try {
        const prism = await Prism.getInstance();
        const session = await getSessionSafely(undefined, authOptions);
        if (!session || !session.user?.id) {
            throw new Error('Unauthorized');
        }
        if (!toolId || !isValidUUID(toolId)) {
            return null;
        }

        const query: PrismContentQuery = {
            contentType: BlockType_Tool,
            tenantId: 'any',
            where: { page_id: toolId },
        };
        const result = await prism.query(query);
        
        if (!result.items || result.items.length === 0) {
            log.warn('Tool not found for user', { toolId, userId: session.user?.id });
            return null;
        }

        const tool = result.items[0] as ITool;
        
        // Check if the tool belongs to the authenticated user
        if (tool.userId !== session.user?.id) {
            log.warn('Tool belongs to different user', { toolId, ownerId: tool.userId, requesterId: session.user?.id });
            throw new Error('Unauthorized');
        }
        return tool;
    } catch (error) {
        log.error('Error getting tool by ID', { toolId, error });
        throw error;
    }
}

/**
 * Updates a tool in the database.
 *
 * @param toolId - The ID of the tool to update.
 * @param toolData - The data to update the tool with.
 * @returns A promise that resolves to the updated tool.
 * @throws Will throw an error if the user is not authenticated or if the tool doesn't belong to the user.
 */
export async function updateTool(toolId: string, tenantId: string, toolData: UpdateToolParams, authOptions: NextAuthOptions): Promise<ITool> {
    try {
        const prism = await Prism.getInstance();
        const session = await getSessionSafely(undefined, authOptions);
        if (!session || !session.user?.id) {
            throw new Error('Unauthorized');
        }
        if (!toolId || !isValidUUID(toolId)) {
            throw new Error('Invalid toolId format');
        }

        // First, get the existing tool to verify ownership
        const existingTool = await getToolById(toolId, authOptions);
        if (!existingTool) {
            throw new Error('Tool not found');
        }

        const updated = await prism.update(BlockType_Tool, toolId, toolData, tenantId);
        if (!updated || updated.total === 0 || updated.items.length === 0) {
            throw new Error('Failed to update tool');
        }

        return updated.items[0] as unknown as ITool;
    } catch (error) {
        log.error('Error updating tool', { toolId, tenantId, error });
        throw error;
    }
}

/**
 * Deletes a tool from the database.
 *
 * @param toolId - The ID of the tool to delete.
 * @returns A promise that resolves to true if the tool was deleted successfully.
 * @throws Will throw an error if the user is not authenticated or if the tool doesn't belong to the user.
 */
export async function deleteTool(toolId: string, tenantId: string, authOptions: NextAuthOptions): Promise<boolean> {
    try {
        const prism = await Prism.getInstance();
        const session = await getSessionSafely(undefined, authOptions);
        if (!session || !session.user?.id) {
            throw new Error('Unauthorized');
        }
        if (!toolId || !isValidUUID(toolId)) {
            throw new Error('Invalid toolId format');
        }

        // First, get the existing tool to verify ownership
        const existingTool = await getToolById(toolId, authOptions);
        if (!existingTool) {
            throw new Error('Tool not found');
        }

        const deleted = await prism.delete(BlockType_Tool, toolId, tenantId);
        if (!deleted) {
            throw new Error('Failed to delete tool');
        }

        return deleted;
    } catch (error) {
        log.error('Error deleting tool', { toolId, tenantId, error });
        throw error;
    }
} 