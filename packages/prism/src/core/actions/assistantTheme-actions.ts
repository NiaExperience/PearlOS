"use server";

import { NextAuthOptions } from 'next-auth';
import { Prism } from '../../prism';
import { getSessionSafely } from '../auth';
import {
  BlockType_AssistantTheme,
  DefaultAssistantTheme,
  DefaultThemeConfig,
  IAssistantTheme
} from '../blocks/assistantTheme.block';
import { IDynamicContent } from '../blocks/dynamicContent.block';
import { validateContentData } from '../content/utils';
import { getLogger } from '../logger';
import { PrismContentQuery } from '../types';

const log = getLogger('prism:actions:assistant-theme');

// Get theme for an assistant (returns default if not found)
export async function getAssistantTheme(assistantId: string, assistantName: string = ''): Promise<IAssistantTheme> {
  try {
    if (assistantId) {
      log.info('Fetching assistant theme', { assistantId });
      const prism = await Prism.getInstance();
      
      const query: PrismContentQuery = {
        contentType: BlockType_AssistantTheme,
        tenantId: 'any',
        where: { parent_id: assistantId },
        orderBy: { createdAt: 'desc' as const },
      };
      
      const result = await prism.query(query);
      
      if (result && result.items && result.items.length > 0) {
        const theme = result.items[0] as IAssistantTheme;
        log.info('Assistant theme retrieved', { assistantId, themeId: theme._id });
        return theme;
      }
    }
    
    log.info('Assistant theme not found, returning default', { assistantId, assistantName });
  } catch (error) {
    log.error('Error getting assistant theme', { assistantId, error });
  }
  
  // Return default theme structure
  return {
    assistant_id: assistantId,
    assistant_name: assistantName,
    enabled: false,
    theme_config: DefaultThemeConfig,
  };
}

// Create or update assistant theme
export async function upsertAssistantTheme(themeData: Partial<IAssistantTheme>, authOptions: NextAuthOptions): Promise<{ success: boolean; data?: IAssistantTheme; error?: string }> {
  try {
    if (!themeData.assistant_id) {
      throw new Error('assistant_id is required');
    }

    log.info('Upserting assistant theme', { assistantId: themeData.assistant_id });
    const prism = await Prism.getInstance();

    const session = await getSessionSafely(undefined, authOptions);
    if (!session || !session.user.id) {
      return { success: false, error: 'Unauthorized' };
    }
    // Check if theme already exists
    const query: PrismContentQuery = {
      contentType: BlockType_AssistantTheme,
      tenantId: 'any',
      where: { parent_id: themeData.assistant_id },
      orderBy: { createdAt: 'desc' as const },
    };
    const result = await prism.query(query);

    // get the content definition for validation
    const defResult = await prism.findDefinition(BlockType_AssistantTheme);
    if (!defResult || defResult.total === 0 || !defResult.items || defResult.items.length === 0) {
      throw new Error('Content definition not found');
    }
    const definition = defResult.items[0] as IDynamicContent;

    if (result && result.items && result.items.length > 0) {
      // Update existing theme
      const existingTheme = result.items[0] as IAssistantTheme;
      const updateData = {
        ...existingTheme,
        ...themeData
      };

      log.debug('Validating assistant theme payload', { assistantId: themeData.assistant_id, payload: updateData });
      const validate = validateContentData(updateData, definition.dataModel);
      if (!validate.success) {
        return { success: false, error: 'Content data does not match schema' };
      }

      const updated = await prism.update(BlockType_AssistantTheme, existingTheme._id!, updateData, 'any');
      log.info('Assistant theme updated', { assistantId: themeData.assistant_id, themeId: updated.items?.[0]?._id });
      return { success: true, data: updated.items[0] as IAssistantTheme };
    } else {
      // Create new theme
      const createData = {
        ...DefaultAssistantTheme,
        ...themeData
      };

      log.debug('Validating assistant theme payload', { assistantId: themeData.assistant_id, payload: createData });
      const validate = validateContentData(createData, definition.dataModel);
      if (!validate.success) {
        return { success: false, error: 'Content data does not match schema' };
      }

      const created = await prism.create(BlockType_AssistantTheme, createData, 'any');
      if (!created || created.total === 0 || created.items.length === 0) {
        throw new Error('Failed to create theme');
      }
      log.info('Assistant theme created', { assistantId: themeData.assistant_id, themeId: created.items[0]?._id });
      return { success: true, data: created.items[0] as IAssistantTheme };
    }
  } catch (error) {
    log.error('Error upserting assistant theme', { assistantId: themeData.assistant_id, error });
    return { success: false, error: 'Failed to upsert assistant theme' };
  }
}

// Update assistant theme
export async function updateAssistantTheme(assistantId: string, themeData: Partial<IAssistantTheme>, authOptions: NextAuthOptions): Promise<{ success: boolean; data?: IAssistantTheme; error?: string }> {
  try {
    log.info('Updating assistant theme', { assistantId });
    const prism = await Prism.getInstance();

    const session = await getSessionSafely(undefined, authOptions);
    if (!session || !session.user.id) {
      return { success: false, error: 'Unauthorized' };
    }
    
    const query: PrismContentQuery = {
      contentType: BlockType_AssistantTheme,
      tenantId: 'any',
      where: { parent_id: assistantId },
      orderBy: { createdAt: 'desc' as const },
    };
    
    const result = await prism.query(query);
    
    if (!result || !result.items || result.items.length === 0) {
      return { success: false, error: 'Theme not found' };
    }
    
    const existingTheme = result.items[0] as IAssistantTheme;
    const updateData = {
      ...existingTheme,
      ...themeData};

    const updated = await prism.update(BlockType_AssistantTheme, existingTheme._id!, updateData, 'any');
    if (!updated || updated.total === 0 || updated.items.length === 0) {
      throw new Error('Failed to update theme');
    }
    log.info('Assistant theme updated', { assistantId, themeId: updated.items?.[0]?._id });
    return { success: true, data: updated.items[0] as IAssistantTheme };
  } catch (error) {
    log.error('Error updating assistant theme', { assistantId, error });
    return { success: false, error: 'Failed to update assistant theme' };
  }
}

// Delete assistant theme
export async function deleteAssistantTheme(assistantId: string, authOptions: NextAuthOptions): Promise<{ success: boolean; error?: string }> {
  try {
    log.info('Deleting assistant theme', { assistantId });
    const prism = await Prism.getInstance();

    const session = await getSessionSafely(undefined, authOptions);
    if (!session || !session.user.id) {
      return { success: false, error: 'Unauthorized' };
    }
    
    const query: PrismContentQuery = {
      contentType: BlockType_AssistantTheme,
      tenantId: 'any',
      where: { parent_id: assistantId },
      orderBy: { createdAt: 'desc' as const },
    };
    
    const result = await prism.query(query);
    
    if (!result || !result.items || result.items.length === 0) {
      return { success: false, error: 'Theme not found' };
    }
    
    const theme = result.items[0] as IAssistantTheme;
    await prism.delete(BlockType_AssistantTheme, theme._id!, 'any');
    
    log.info('Assistant theme deleted', { assistantId, themeId: theme._id });
    return { success: true };
  } catch (error) {
    log.error('Error deleting assistant theme', { assistantId, error });
    return { success: false, error: 'Failed to delete assistant theme' };
  }
}

// Get all themes
export async function getAllThemes(authOptions: NextAuthOptions): Promise<{ success: boolean; data?: IAssistantTheme[]; error?: string }> {
  try {
    log.info('Fetching all assistant themes');
    const prism = await Prism.getInstance();

    const session = await getSessionSafely(undefined, authOptions);
    if (!session || !session.user.id) {
      return { success: false, error: 'Unauthorized' };
    }
    
    const query: PrismContentQuery = {
      contentType: BlockType_AssistantTheme,
      tenantId: 'any',
      where: {},
      orderBy: { createdAt: 'desc' as const },
    };
    
    const result = await prism.query(query);
    
    log.info('Fetched all assistant themes', { count: result.items?.length || 0 });
    return { success: true, data: result.items as IAssistantTheme[] };
  } catch (error) {
    log.error('Error fetching all themes', { error });
    return { success: false, error: 'Failed to fetch all themes' };
  }
} 