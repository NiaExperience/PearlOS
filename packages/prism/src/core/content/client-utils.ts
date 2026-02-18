import type { DynamicContentUIConfig } from '../blocks/dynamicContent.block';
import { JSONProperties } from './types';
import type { AnySchemaObject } from 'ajv/dist/types';

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
 */
export function getContentFieldRoles(
  fields: JSONProperties,
  uiConfig?: DynamicContentUIConfig
) {
  // Prefer schema-driven config if present
  const cardConfig = uiConfig?.card as Record<string, string | undefined> | undefined;
  const detailConfig = uiConfig?.detailView as Record<string, string | undefined> | undefined;

  // Helper to resolve a field from config or fallback
  const resolveField = (configKey: string, candidates: string[]) => {
    if (cardConfig && typeof cardConfig[configKey] === 'string' && fields[cardConfig[configKey] as string]) return cardConfig[configKey] as string;
    if (detailConfig && typeof detailConfig[configKey] === 'string' && fields[detailConfig[configKey] as string]) return detailConfig[configKey] as string;
    return candidates.find((c) => Object.keys(fields).includes(c));
  };

  const imageField = resolveField('imageField', IMAGE_FIELDS);
  const titleField = resolveField('titleField', TITLE_FIELDS);
  const descriptionField = resolveField('descriptionField', DESCRIPTION_FIELDS);
  const tagField = resolveField('tagField', TAG_FIELDS);
  const linkField = resolveField('linkField', LINK_FIELDS);

  // Meta fields: up to 2 non-title, non-description, non-image fields
  const metaFields = Object.keys(fields)
    .filter((key) => ![imageField, titleField, descriptionField, tagField, linkField, '_id'].includes(key))
    .slice(0, 2);

  // Extra fields: all fields not shown in card summary (for detail view)
  const summaryFields = [imageField, titleField, descriptionField, tagField, linkField, ...metaFields].filter(Boolean);
  const extraFields = Object.keys(fields).filter((f) => !summaryFields.includes(f));

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
 * Get field display name (human-readable)
 */
export function getFieldDisplayName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .replace(/_/g, ' ');
}

/**
 * Format field value for display
 */
export function formatFieldValue(
  value: unknown,
  field: AnySchemaObject
): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof field === 'boolean')
    return value ? 'Yes' : 'No';

  switch (field.type) {
    case 'integer':
      return Number(value).toString();
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'array':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'object':
    case 'string':
    default:
      if (field.format === 'date-time' || field.format === 'date') {
        const date = new Date(value as string);
        return isNaN(date.getTime()) ? '' : date.toISOString();
      }
      return String(value);   
    }
}

export function generateSubdomain(assistant_name: string) {
  // Convert to lowercase and replace all non-alphabetic characters with hyphens
  return assistant_name
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, '') // Remove everything except lowercase letters and spaces
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove hyphens from start and end
}