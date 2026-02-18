import { useState, useCallback } from 'react';

import { DynamicContentBlock } from '../blocks';

import { dynamicContentClient } from './client';
import { ContentData } from './types';

/**
 * React hooks for dynamic content operations
 */

export interface UseDynamicContentDefinitionOptions {
  onSuccess?: (data: DynamicContentBlock.IDynamicContent) => void;
  onError?: (error: Error) => void;
}

export interface UseDynamicContentOptions {
  onSuccess?: (data: ContentData) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for managing dynamic content definitions
 */
export function useDynamicContentDefinitions(tenantId: string) {
  const [definitions, setDefinitions] = useState<DynamicContentBlock.IDynamicContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDefinitions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await dynamicContentClient.listDefinitions(tenantId);
      setDefinitions(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch definitions'));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const createDefinition = useCallback(async (
    definition: DynamicContentBlock.IDynamicContent,
    options?: UseDynamicContentDefinitionOptions
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.createDefinition(definition);
      if (result.success) {
        setDefinitions(prev => [...prev, result.data]);
        options?.onSuccess?.(result.data);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create definition');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const replaceDefinition = useCallback(async (
    definitionId: string,
    definition: DynamicContentBlock.IDynamicContent,
    options?: UseDynamicContentDefinitionOptions
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.replaceDefinition(definitionId, definition);
      if (result.success) {
        setDefinitions(prev => prev.map(d => d._id === definitionId ? result.data : d));
        options?.onSuccess?.(result.data);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update definition');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteDefinition = useCallback(async (
    blockType: string,
    definitionId: string,
    options?: UseDynamicContentDefinitionOptions
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.deleteDefinition(blockType, definitionId);
      if (result.success) {
        setDefinitions(prev => prev.filter(d => d._id !== definitionId));
        if (result.data) {
          options?.onSuccess?.(result.data);
        }
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to delete definition');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    definitions,
    loading,
    error,
    fetchDefinitions,
    createDefinition,
    replaceDefinition,
    deleteDefinition,
  };
}

/**
 * Hook for managing dynamic content data
 */
export function useDynamicContent(definitionId: string) {
  const [content, setContent] = useState<ContentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchContent = useCallback(async (filter: Record<string, unknown> = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await dynamicContentClient.listContent(filter, definitionId);
      setContent(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch content'));
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  const createContent = useCallback(async (
    data: ContentData,
    blockId?: string,
    options?: UseDynamicContentOptions
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.createContent(data, definitionId, blockId);
      if (result.success) {
        setContent(prev => [...prev, result.data]);
        options?.onSuccess?.(result.data);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create content');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  const updateContent = useCallback(async (
    contentId: string,
    data: ContentData,
    options?: UseDynamicContentOptions
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.updateContent(definitionId, contentId, data);
      if (result.success) {
        setContent(prev => prev.map(item => 
          (item._id as string) === contentId ? result.data : item
        ));
        options?.onSuccess?.(result.data);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update content');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  const deleteContent = useCallback(async (
    contentId: string,
    options?: UseDynamicContentOptions
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.deleteContent(definitionId, contentId);
      if (result.success) {
        setContent(prev => prev.filter(item => (item._id as string) !== contentId));
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to delete content');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  const searchContent = useCallback(async (
    query: {
      where?: Record<string, unknown>;
      order?: Array<[string, 'ASC' | 'DESC']>;
      limit?: number;
      offset?: number;
    } = {}
  ) => {
    setLoading(true);
    setError(null);
    try {
      const data = await dynamicContentClient.searchContent(query, definitionId);
      setContent(data);
      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to search content');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  return {
    content,
    loading,
    error,
    fetchContent,
    createContent,
    updateContent,
    deleteContent,
    searchContent,
  };
}

/**
 * Hook for managing a single dynamic content item
 */
export function useDynamicContentItem(definitionId: string, contentId: string) {
  const [item, setItem] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchItem = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await dynamicContentClient.getContent(definitionId, contentId);
      setItem(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch item'));
    } finally {
      setLoading(false);
    }
  }, [definitionId, contentId]);

  const updateItem = useCallback(async (
    data: ContentData,
    options?: UseDynamicContentOptions
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.updateContent(definitionId, contentId, data);
      if (result.success) {
        setItem(result.data);
        options?.onSuccess?.(result.data);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update item');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [definitionId, contentId]);

  const deleteItem = useCallback(async (options?: UseDynamicContentOptions) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dynamicContentClient.deleteContent(definitionId, contentId);
      if (result.success) {
        setItem(null);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to delete item');
      setError(error);
      options?.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [definitionId, contentId]);

  return {
    item,
    loading,
    error,
    fetchItem,
    updateItem,
    deleteItem,
  };
} 