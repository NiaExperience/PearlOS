/**
 * GraphQL Types
 * 
 * Type definitions for GraphQL schema entities
 */

// Content types
export interface NotionModel {
  block_id: string;
  page_id?: string;
  parent_id?: string;
  type: string;
  content: any; // JSON type - can be any valid JSON value
  indexer?: any;
  order?: number;
  version?: string;
  parentData?: NotionModel;
}

// Input types
export interface NotionModelInput {
  page_id?: string;
  parent_id?: string;
  type: string;
  content: any; // JSON type - can be any valid JSON value
  indexer?: any;
  order?: number;
  version?: string;
}

// Filter types
export interface StringFilter {
  eq?: string;
  ne?: string;
  in?: string[];
  like?: string;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
}

export interface IntFilter {
  eq?: number;
  ne?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: number[];
}

export interface JSONFilter {
  path: string;
  equals?: any;
  contains?: any;
}

export interface NotionModelFilter {
  block_id?: StringFilter;
  page_id?: StringFilter;
  parent_id?: StringFilter;
  type?: StringFilter;
  content?: StringFilter;
  indexer?: JSONFilter;
  order?: IntFilter;
  version?: StringFilter;
  OR?: NotionModelFilter[];
  AND?: NotionModelFilter[];
}

// Sorting types
export type OrderDirection = 'ASC' | 'DESC';

export interface OrderByInput {
  field: string;
  direction: OrderDirection;
}

