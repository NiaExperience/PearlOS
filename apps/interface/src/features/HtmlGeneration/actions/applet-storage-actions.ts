/**
 * Actions for managing AppletStorage content
 * Provides CRUD operations for applet data persistence
 */

import { Prism, PrismContentResult } from '@nia/prism';
import { ContentActions } from '@nia/prism/core/actions';

import { getLogger } from '@interface/lib/logger';

import { AppletStorageDefinition } from '../definition';

const log = getLogger('[html-generation.applet-storage-actions]');

/**
 * Creates the AppletStorage definition in the database
 * This should be called once per tenant to set up the content type
 * 
 * @param tenantId - The tenant identifier
 * @returns Promise resolving to the created definition
 */
async function createAppletStorageDefinition(tenantId: string) {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(AppletStorageDefinition, tenantId);
  
  if (!created) {
    throw new Error(`Failed to create dynamic content definition for ${AppletStorageDefinition.dataModel.block}`);
  }
  
  return created.items[0];
}

/**
 * Ensures that the AppletStorage definition exists before executing an operation.
 * If the definition doesn't exist, it creates it automatically and retries the operation.
 * This is a helper function that provides resilient operation handling.
 * 
 * @param operation - The async operation to execute that requires the AppletStorage definition
 * @param tenantId - The tenant identifier for creating the definition if needed
 * @returns Promise resolving to the operation result
 * @throws Error if the operation fails even after ensuring definition exists
 * 
 * @internal This is an internal helper function
 */
export async function ensureAppletStorageDefinition<T>(operation: () => Promise<T>, tenantId: string): Promise<T> {
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    const msg = `Content definition for type "${AppletStorageDefinition.dataModel.block}" not found.`;
    if (error instanceof Error && error.message.includes(msg)) {
      await createAppletStorageDefinition(tenantId);
      log.warn('Retrying operation after creating AppletStorage definition', { tenantId });
      result = await operation(); // Retry the operation after creating the definition
    } else {
      log.error('Error in ensureAppletStorageDefinition', { err: error });
      throw error;
    }
  }
  return result;
}

/**
 * Creates a new AppletStorage record
 * 
 * @param data - The data to store
 * @param userId - The user ID who owns this data
 * @param tenantId - The tenant identifier
 * @param appletId - Optional applet ID to associate with this data
 * @returns Promise resolving to the created record
 */
export async function createAppletStorage(
  data: unknown,
  userId: string,
  tenantId: string,
  appletId?: string
): Promise<Record<string, unknown>> {
  try {
    const prism = await Prism.getInstance();
    
    const storageRecord = {
      data,
      userId,
      appletId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const func = async () => {
      return await prism.create(
        AppletStorageDefinition.dataModel.block,
        storageRecord,
        tenantId
      );
    };

    const created = await ensureAppletStorageDefinition(func, tenantId);
    
    if (!created || created.total === 0) {
      throw new Error('Failed to create AppletStorage record');
    }
    
    return created.items[0];
  } catch (error) {
    log.error('Error creating AppletStorage', { err: error });
    throw error;
  }
}

/**
 * Finds AppletStorage records matching a query
 * 
 * @param query - Query object with filters
 * @param tenantId - The tenant identifier
 * @returns Promise resolving to matching records
 */
export async function findAppletStorage(
  query: Record<string, unknown>,
  tenantId: string
): Promise<PrismContentResult> {
  try {
    const func = async () => {
      return await ContentActions.findContent({
        tenantId,
        contentType: AppletStorageDefinition.dataModel.block,
        where: query
      });
    };

    return await ensureAppletStorageDefinition(func, tenantId);
  } catch (error) {
    log.error('Error finding AppletStorage', { err: error });
    throw error;
  }
}

/**
 * Updates an existing AppletStorage record
 * 
 * @param dataId - The ID of the record to update
 * @param data - The new data
 * @param tenantId - The tenant identifier
 * @returns Promise resolving to the updated record
 */
export async function updateAppletStorage(
  dataId: string,
  data: unknown,
  tenantId: string,
  userId?: string
): Promise<Record<string, unknown>> {
  try {
    const updatedRecord: Record<string, unknown> = {
      data,
      updatedAt: new Date().toISOString()
    };

    // Preserve userId if provided (prevents it from being removed on update)
    if (userId) {
      updatedRecord.userId = userId;
    }

    const func = async () => {
      return await ContentActions.updateContent(
        AppletStorageDefinition.dataModel.block,
        dataId,
        updatedRecord,
        tenantId
      );
    };

    const result = await ensureAppletStorageDefinition(func, tenantId);
    
    if (!result || result.total === 0) {
      throw new Error('Failed to update AppletStorage record');
    }
    
    return result.items[0];
  } catch (error) {
    log.error('Error updating AppletStorage', { err: error });
    throw error;
  }
}

/**
 * Deletes an AppletStorage record
 * 
 * @param dataId - The ID of the record to delete
 * @param tenantId - The tenant identifier
 * @returns Promise resolving to true if deleted successfully
 */
export async function deleteAppletStorage(
  dataId: string,
  tenantId: string
): Promise<boolean> {
  try {
    const func = async () => {
      return await ContentActions.deleteContent(
        AppletStorageDefinition.dataModel.block,
        dataId,
        tenantId
      );
    };

    return await ensureAppletStorageDefinition(func, tenantId);
  } catch (error) {
    log.error('Error deleting AppletStorage', { err: error });
    throw error;
  }
}
