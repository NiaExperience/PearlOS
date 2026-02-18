/* eslint-disable @typescript-eslint/no-explicit-any */
import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import type { AnySchemaObject } from 'ajv/dist/types';
import { DynamicContentBlock } from '../blocks';
import type { DynamicContentUIConfig, DynamicContentDataModel } from '../blocks/dynamicContent.block';
import { ContentData } from './types';
import { getLogger } from '../logger';

const logger = getLogger('prism:content:utils');


const ajv = new Ajv();
addFormats(ajv);

/**
 * Utility to get BlockType and Schema from the block namespace
 */
export function getBlockMeta(dataModel: DynamicContentBlock.DynamicContentDataModel) {

  const BlockType = dataModel.block;
  // Deep clone the schema to avoid mutation issues
  const Schema = JSON.parse(JSON.stringify(dataModel.jsonSchema));

  if (!BlockType || !Schema) throw new Error(`BlockType or Schema missing for data model: ${dataModel}`);
  return { BlockType, Schema };
}

/**
 * Utility to get the actual value from a string input
 * Attempts to parse JSON, convert dates, or return the original string
 * 
 * @param input - The input value to process
 * @returns The processed value (object, array, date, or original string)
 * 
 * @example
 * ```typescript
 * getActualValue('{"name": "John", "age": 30}') // Returns: { name: "John", age: 30 }
 * getActualValue('2023-01-01T00:00:00.000Z') // Returns: Date object
 * getActualValue('simple string') // Returns: 'simple string'
 * ```
 */
export function getActualValue(input: any): any {
  try {
    // Attempt to parse the string as JSON
    const parsed = JSON.parse(input);

    // Check if the parsed value is an object or array
    if (parsed && (typeof parsed === 'object' || Array.isArray(parsed))) {
      return parsed;
    }
  } catch {
    // Ignore parsing errors, fall through
  }

  // Check if the string is a valid ISO 8601 date string, using a regular expression
  // This regex checks for the format YYYY-MM-DDTHH:mm:ss.sssZ
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  if (isoDateRegex.test(input)) {
    return new Date(input);
  }

  // Return the original string if it's neither valid JSON nor a valid date
  return input;
}

/**
 * Utility to get a nested value from an object using dot notation
 * e.g., getNestedValue(data, 'address.city') returns data.address.city
 */
function getNestedValue(obj: ContentData, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Validate data against a dynamic content definition
 */
export function validateContentData(
  data: ContentData,
  dataModel: { jsonSchema: AnySchemaObject }
): { success: boolean; errors?: Record<string, string[]> } {
  // Deep clone the schema to avoid mutation issues
  const errors: Record<string, string[]> = {};
  try {
    const schema = JSON.parse(JSON.stringify(dataModel.jsonSchema || {}));
    const validate = ajv.compile(schema);
    const valid = validate(data);
    if (valid) {
      return { success: true };
    }
    (validate.errors as ErrorObject[]).forEach((err) => {
      const path = err.instancePath || err.schemaPath || 'unknown';
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(err.message || 'Validation error');
    });
  } catch (error) {
    const msg = `Error during validation: ${error}`;
    logger.error('Validation error in content utils', {
      error: error instanceof Error ? error.message : String(error),
    });
    errors['exception'] = [msg];
  }
  return { success: false, errors };
}

// Note: isFieldRequired is already exported from ./types

/**
 * Get field display name (human-readable)
 */
export function getFieldDisplayName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .replace(/_/g, ' ');
}

/**
 * Generate a unique ID for form fields
 */
export function generateFieldId(prefix: string, fieldName: string): string {
  return `${prefix}-${fieldName}`.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Extract field errors from validation result
 */
export function extractFieldErrors(
  errors: Record<string, string[]> | undefined,
  fieldName: string
): string[] {
  if (!errors) return [];

  // Check for exact field match
  if (errors[fieldName]) {
    return errors[fieldName];
  }

  // Check for nested field matches (e.g., "address.city" for "address")
  const nestedErrors: string[] = [];
  for (const [key, messages] of Object.entries(errors)) {
    if (key.startsWith(`${fieldName}.`)) {
      nestedErrors.push(...messages);
    }
  }

  return nestedErrors;
}

// Field name conventions
const IMAGE_FIELDS = ['photo', 'logo', 'image', 'avatar', 'picture'];
const TITLE_FIELDS = ['title', 'name'];
const DESCRIPTION_FIELDS = ['description', 'bio', 'summary'];
const TAG_FIELDS = ['categories', 'tags', 'exTags'];
const LINK_FIELDS = ['tellMeMore', 'link', 'url', 'website'];

/**
 * Get content field roles for card/detail rendering, using schema hints if present.
 *
 * Supports uiConfig.card and uiConfig.detailView for schema-driven customization.
 * Falls back to field name conventions if not specified.
 *
 * TODO: Support custom field renderers via a renderers map.
 * TODO: Add memoization for performance in large lists.
 * TODO: Add accessibility helpers for ARIA/keyboard navigation.
 */
export function getContentFieldRoles(
  jsonSchema: any, // expects a JSON Schema with properties
  uiConfig?: DynamicContentUIConfig
) {
  // Extract available fields from jsonSchema.properties
  const properties = (jsonSchema && typeof jsonSchema === 'object' && jsonSchema.properties && typeof jsonSchema.properties === 'object')
    ? jsonSchema.properties as Record<string, any>
    : {};
  const fieldKeys = Object.keys(properties);

  // Prefer schema-driven config if present
  const cardConfig = uiConfig?.card as Record<string, string | undefined> | undefined;
  const detailConfig = uiConfig?.detailView as Record<string, string | undefined> | undefined;

  // Helper to resolve a field from config or fallback
  const resolveField = (configKey: string, candidates: string[]) => {
    if (cardConfig && typeof cardConfig[configKey] === 'string' && fieldKeys.includes(cardConfig[configKey] as string)) return cardConfig[configKey] as string;
    if (detailConfig && typeof detailConfig[configKey] === 'string' && fieldKeys.includes(detailConfig[configKey] as string)) return detailConfig[configKey] as string;
    return candidates.find((c) => fieldKeys.includes(c));
  };

  const imageField = resolveField('imageField', IMAGE_FIELDS);
  const titleField = resolveField('titleField', TITLE_FIELDS);
  const descriptionField = resolveField('descriptionField', DESCRIPTION_FIELDS);
  const tagField = resolveField('tagField', TAG_FIELDS);
  const linkField = resolveField('linkField', LINK_FIELDS);

  // Meta fields: up to 2 non-title, non-description, non-image fields
  const metaFields = fieldKeys
    .filter((key) => ![imageField, titleField, descriptionField, tagField, linkField, '_id'].includes(key))
    .slice(0, 2);

  // Extra fields: all fields not shown in card summary (for detail view)
  const summaryFields = [imageField, titleField, descriptionField, tagField, linkField, ...metaFields].filter(Boolean);
  const extraFields = fieldKeys.filter((f) => !summaryFields.includes(f));

  return {
    imageField,
    titleField,
    descriptionField,
    tagField,
    linkField,
    metaFields,
    extraFields,
  };
}

/**
 * Utility to determine parent_id for a new record
 */
export function resolveParentId(data: ContentData, dataModel: DynamicContentDataModel): string | undefined {
  const parent = dataModel.parent;
  if (!parent || parent.type === 'none') return undefined;
  if (parent.type === 'id' && parent.id) {
    // If parent type is 'id', return the id directly
    return parent.id as string;
  } else if (parent.type === 'field' && parent.field) {
    // If the parent type is 'field', the parent is one the fields of the data
    return data[parent.field] as string;
  }
  return undefined;
}

/**
 * Builds an indexer object based on specified fields in the data
 */
export function buildIndexer(data: any, indexFields: string[] = []): Record<string, unknown> | undefined {
  if (!indexFields || indexFields.length === 0) return undefined;
  const indexer: Record<string, unknown> = {};
  for (const field of indexFields) {
    if (field.includes('.')) {
      // Handle nested field access
      const value = getNestedValue(data, field);
      if (value !== undefined) {
        const path = field.split('.');
        let current = indexer;
        for (let i = 0; i < path.length - 1; i++) {
          if (!current[path[i]]) {
            current[path[i]] = {};
          }
          current = current[path[i]] as Record<string, unknown>;
        }
        current[path[path.length - 1]] = value;
      }
    } else {
      if (field in data) {
        indexer[field] = data[field];
      }
    }
  }
  return indexer;
}
