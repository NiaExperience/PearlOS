import { DynamicContentBlock } from '../blocks';

import { ContentData } from './types';

/**
 * Client-safe dynamic content client for dashboard UI
 * Uses fetch API calls instead of direct server-side imports
 */

export interface DynamicContentClientConfig {
  baseUrl?: string;
  apiPrefix?: string;
}

export class DynamicContentClient {
  private baseUrl: string;
  private apiPrefix: string;

  constructor(config: DynamicContentClientConfig = {}) {
    this.baseUrl = config.baseUrl || '';
    this.apiPrefix = config.apiPrefix || '/api/dynamicContent';
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${this.apiPrefix}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dynamic content API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Create a new dynamic content type definition
   */
  async createDefinition(definition: DynamicContentBlock.IDynamicContent): Promise<{ success: boolean; data: DynamicContentBlock.IDynamicContent }> {
    return this.request('/definitions', {
      method: 'POST',
      body: JSON.stringify(definition),
    });
  }

  /**
   * Get a dynamic content type definition by ID
   */
  async getDefinition(definitionId: string): Promise<DynamicContentBlock.IDynamicContent | null> {
    return this.request(`/definitions/${definitionId}`);
  }

  /**
   * List all dynamic content type definitions for a tenant
   */
  async listDefinitions(tenantId: string): Promise<DynamicContentBlock.IDynamicContent[]> {
    return this.request(`/definitions?tenantId=${tenantId}`);
  }

  /**
   * Replace a dynamic content type definition
   */
  async replaceDefinition(definitionId: string, definition: DynamicContentBlock.IDynamicContent): Promise<{ success: boolean; data: DynamicContentBlock.IDynamicContent }> {
    return this.request(`/definitions/${definitionId}`, {
      method: 'PUT',
      body: JSON.stringify(definition),
    });
  }

  /**
   * Delete a dynamic content type definition
   */
  async deleteDefinition(blockType: string, definitionId: string): Promise<{ success: boolean; data?: DynamicContentBlock.IDynamicContent }> {
    return this.request(`/definitions/${definitionId}?blockType=${blockType}`, {
      method: 'DELETE',
    });
  }

  /**
   * Create content using a dynamic content definition
   */
  async createContent(
    data: ContentData,
    definitionId: string,
    blockId?: string
  ): Promise<{ success: boolean; data: ContentData }> {
    return this.request(`/content/${definitionId}`, {
      method: 'POST',
      body: JSON.stringify({ data, blockId }),
    });
  }

  /**
   * Get content by ID using a dynamic content definition
   */
  async getContent(contentId: string, definitionId: string): Promise<ContentData | null> {
    return this.request(`/content/${definitionId}/${contentId}`);
  }

  /**
   * List content using a dynamic content definition with optional filtering
   */
  async listContent(
    filter: Record<string, unknown> = {},
    definitionId: string
  ): Promise<ContentData[]> {
    const queryParams = new URLSearchParams();
    if (Object.keys(filter).length > 0) {
      queryParams.append('filter', JSON.stringify(filter));
    }
    
    return this.request(`/content/${definitionId}?${queryParams.toString()}`);
  }

  /**
   * Update content using a dynamic content definition
   */
  async updateContent(
    contentId: string,
    definitionId: string,
    data: ContentData
  ): Promise<{ success: boolean; data: ContentData }> {
    return this.request(`/content/${definitionId}/${contentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete content using a dynamic content definition
   */
  async deleteContent(contentId: string, definitionId: string): Promise<{ success: boolean }> {
    return this.request(`/content/${definitionId}/${contentId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Search content using a dynamic content definition with advanced querying
   */
  async searchContent(
    query: {
      where?: Record<string, unknown>;
      order?: Array<[string, 'ASC' | 'DESC']>;
      limit?: number;
      offset?: number;
    } = {},
    definitionId: string
  ): Promise<ContentData[]> {
    return this.request(`/content/${definitionId}/search`, {
      method: 'POST',
      body: JSON.stringify(query),
    });
  }
}

// Default client instance
export const dynamicContentClient = new DynamicContentClient();

// Export individual functions for convenience
export const {
  createDefinition,
  getDefinition,
  listDefinitions,
  replaceDefinition,
  deleteDefinition,
  createContent,
  getContent,
  listContent,
  updateContent,
  deleteContent,
  searchContent,
} = dynamicContentClient; 