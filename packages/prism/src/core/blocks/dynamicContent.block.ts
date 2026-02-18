import type { AnySchemaObject } from 'ajv/dist/types';
import { z } from 'zod';
import { PlatformProvider, ProviderConfig, ProviderConfigSchema } from '../../data-bridge/provider';

// BlockType identifier
export const BlockType_DynamicContent = 'DynamicContent';

export interface DynamicContentDataModel {
  block: string;
  jsonSchema: AnySchemaObject; // Changed from JSONSchema7 to any
  indexer?: string[];
  parent?: {
    type: 'none' | 'id' | 'field';
    id?: string;
    field?: string;
    query?: Record<string, unknown>;
  };
  provider?: string | ProviderConfig;
}

// Zod schema for the data model
export const DynamicContentDataModelSchema = z.object({
  block: z.string(),
  jsonSchema: z.record(z.any()),
  indexer: z.array(z.string()).optional(),
  parent: z.object({
    type: z.enum(['none', 'id', 'field']),
    id: z.string().optional(),
    field: z.string().optional(),
    query: z.record(z.unknown()).optional(),
  }).optional(),
  provider: z.union([z.string(), ProviderConfigSchema]).optional().default(PlatformProvider),
});

// Json schema for the data model
const DynamicContentJsonSchema = {
  additionalProperties: false,
  properties: {
    block: { type: "string" },
    jsonSchema: { type: "object", additionalProperties: true },
    indexer: {
      type: "array",
      items: { type: "string" },
    },
    parent: {
      type: "object",
      properties: {
        type: { enum: ["none", "id", "field"] },
        id: { type: "string" },
        field: { type: "string" },
        query: { type: "object", additionalProperties: true },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  required: ["block", "jsonSchema"],
};

export const DynamicContentPlatformDefiniition: IDynamicContent = {
  name: BlockType_DynamicContent,
  dataModel: {
    block: BlockType_DynamicContent,
    jsonSchema: DynamicContentJsonSchema,
    provider: PlatformProvider
  }
};


export interface DynamicContentUIConfig {
  labels?: Record<string, string>;
  listView?: { displayFields?: string[] };
  detailView?: { displayFields?: string[] };
  card?: {
    imageField?: string;
    titleField?: string;
    descriptionField?: string;
    tagField?: string;
    linkField?: string;
  };
}

// Zod schema for the UI config
export const DynamicContentUIConfigSchema = z.object({
  labels: z.record(z.string()).optional(),
  listView: z.object({
    displayFields: z.array(z.string()).optional(),
  }).optional(),
  detailView: z.object({
    displayFields: z.array(z.string()).optional(),
  }).optional(),
  card: z.object({
    imageField: z.string().optional(),
    titleField: z.string().optional(),
    descriptionField: z.string().optional(),
    tagField: z.string().optional(),
    linkField: z.string().optional(),
  }).optional(),
});

export interface DynamicContentAccess {
  tenantRole?: string;
  allowAnonymous?: boolean;
}

export const DynamicContentAccessSchema = z.object({
  tenantRole: z.string().optional(),
  allowAnonymous: z.boolean().default(true),
});


// Zod schema for the dynamic content definition
export const DynamicContentSchema = z.object({
  _id: z.string().optional(), // Unique identifier for the content type
  name: z.string(), // Human-readable name for the content type
  tenantId: z.string().optional(), // Not used for top level blocks (User)
  description: z.string().optional(),
  dataModel: DynamicContentDataModelSchema,
  uiConfig: DynamicContentUIConfigSchema,
  access: DynamicContentAccessSchema,
});

// TypeScript interface for the stored object
export interface IDynamicContent {
  _id?: string; // Unique identifier for the content type
  name: string;
  tenantId?: string,
  description?: string;
  dataModel: DynamicContentDataModel;
  uiConfig?: DynamicContentUIConfig;
  access?: DynamicContentAccess;
}

export const Schema = DynamicContentSchema; 