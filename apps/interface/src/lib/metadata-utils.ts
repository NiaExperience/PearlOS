/**
 * Utilities for formatting and handling user profile metadata
 */

import * as yaml from 'js-yaml';

// Constants for safety limits
const MAX_KEY_LENGTH = 255;
const MAX_VALUE_STRING_LENGTH = 10000; // 10KB max for string values
const MAX_ARRAY_ITEMS = 1000;
const MAX_OBJECT_DEPTH = 10;

/**
 * Format a metadata key for display (convert snake_case/camelCase to readable)
 * Examples:
 * - "avg_day" -> "Avg day"
 * - "worldChange" -> "World Change"
 * - "earliest_tech_memory" -> "Earliest tech memory"
 * 
 * @throws {Error} If key is invalid or too long
 */
export function formatMetadataKey(key: string): string {
  if (typeof key !== 'string') {
    throw new Error('Key must be a string');
  }
  if (key.length === 0) {
    return '';
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(`Key length exceeds maximum of ${MAX_KEY_LENGTH} characters`);
  }
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Convert a value to a string format suitable for editing
 * Arrays are converted to newline-separated strings
 * Objects are converted to JSON strings
 * Primitives are converted to strings
 * 
 * @throws {Error} If value structure is too large or has circular references
 */
export function valueToEditString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  if (Array.isArray(value)) {
    // Limit array size to prevent DoS
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new Error(`Array size exceeds maximum of ${MAX_ARRAY_ITEMS} items`);
    }
    
    // Check if array contains complex objects (objects with multiple keys)
    const hasComplexObjects = value.some((item) => 
      typeof item === 'object' && 
      item !== null && 
      Object.keys(item).length > 1
    );
    
    // If array contains complex objects, treat as YAML for editing
    if (hasComplexObjects) {
      try {
        const yamlString = yaml.dump(value, {
          indent: 2,
          lineWidth: 120,
          noRefs: true, // Prevent circular references
        });
        if (yamlString.length > MAX_VALUE_STRING_LENGTH) {
          throw new Error(`YAML value exceeds maximum length of ${MAX_VALUE_STRING_LENGTH} characters`);
        }
        return yamlString;
      } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes('circular')) {
          throw new Error('Array contains circular references and cannot be serialized');
        }
        throw new Error(`Failed to serialize array: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // For simple arrays (strings, numbers, or simple objects), use newline-separated format
    const result = value.map((item) => {
      if (typeof item === 'object' && item !== null) {
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      }
      return String(item);
    }).join('\n');
    
    if (result.length > MAX_VALUE_STRING_LENGTH) {
      throw new Error(`Converted value exceeds maximum length of ${MAX_VALUE_STRING_LENGTH} characters`);
    }
    return result;
  }
  
  if (typeof value === 'object') {
    try {
      const yamlString = yaml.dump(value, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });
      if (yamlString.length > MAX_VALUE_STRING_LENGTH) {
        throw new Error(`YAML value exceeds maximum length of ${MAX_VALUE_STRING_LENGTH} characters`);
      }
      return yamlString;
    } catch (error: unknown) {
      // Handle circular references or other serialization errors
      if (error instanceof Error && error.message?.includes('circular')) {
        throw new Error('Object contains circular references and cannot be serialized');
      }
      throw new Error(`Failed to serialize object: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  const stringValue = String(value);
  if (stringValue.length > MAX_VALUE_STRING_LENGTH) {
    throw new Error(`Value length exceeds maximum of ${MAX_VALUE_STRING_LENGTH} characters`);
  }
  return stringValue;
}

/**
 * Validates and sanitizes a parsed value to prevent prototype pollution and other security issues
 */
function sanitizeParsedValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new Error(`Object depth exceeds maximum of ${MAX_OBJECT_DEPTH} levels`);
  }

  if (value === null || value === undefined) {
    return value;
  }

  // Prevent prototype pollution by rejecting __proto__ and constructor keys
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) {
        throw new Error(`Array size exceeds maximum of ${MAX_ARRAY_ITEMS} items`);
      }
      return value.map((item) => sanitizeParsedValue(item, depth + 1));
    }

    // Check for prototype pollution attempts
    const keys = Object.keys(value);
    if (keys.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
      throw new Error('Invalid keys detected: object contains prohibited keys');
    }

    // Recursively sanitize nested objects
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      // Validate key length
      if (key.length > MAX_KEY_LENGTH) {
        throw new Error(`Key length exceeds maximum of ${MAX_KEY_LENGTH} characters`);
      }
      sanitized[key] = sanitizeParsedValue(val, depth + 1);
    }
    return sanitized;
  }

  // For primitives, validate length
  if (typeof value === 'string' && value.length > MAX_VALUE_STRING_LENGTH) {
    throw new Error(`String length exceeds maximum of ${MAX_VALUE_STRING_LENGTH} characters`);
  }

  return value;
}

/**
 * Convert an edit string back to a value
 * Tries to detect arrays (newline-separated), JSON objects, or keeps as string
 * 
 * @throws {Error} If input is invalid, too large, or contains security risks
 */
export function editStringToValue(
  editString: string,
  originalValue: unknown
): unknown {
  if (typeof editString !== 'string') {
    throw new Error('Input must be a string');
  }

  // Limit input size to prevent DoS
  if (editString.length > MAX_VALUE_STRING_LENGTH * 2) {
    throw new Error(`Input length exceeds maximum of ${MAX_VALUE_STRING_LENGTH * 2} characters`);
  }

  const trimmed = editString.trim();
  if (trimmed === '') {
    return null;
  }

  // If original was an array, check if input looks like JSON array or YAML
  if (Array.isArray(originalValue)) {
    // Check if the input is a JSON array (starts with [ and ends with ])
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        // Parse as JSON array
        const parsed = JSON.parse(trimmed, (key, value) => {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
          }
          return value;
        });
        
        if (!Array.isArray(parsed)) {
          throw new Error('Expected an array');
        }
        
        if (parsed.length > MAX_ARRAY_ITEMS) {
          throw new Error(`Array size exceeds maximum of ${MAX_ARRAY_ITEMS} items`);
        }
        
        return sanitizeParsedValue(parsed);
      } catch (error: unknown) {
        throw new Error(`Invalid JSON array: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Check if it looks like YAML (contains '- ' at start of lines or key: value pairs)
    if (trimmed.includes('\n- ') || trimmed.match(/^\s*-\s+\w+:/m) || trimmed.match(/^\s*\w+:\s+/m)) {
      try {
        const parsed = yaml.load(trimmed, {
          schema: yaml.JSON_SCHEMA, // Use JSON-compatible schema for safety
        });
        
        if (!Array.isArray(parsed)) {
          throw new Error('Expected an array');
        }
        
        if (parsed.length > MAX_ARRAY_ITEMS) {
          throw new Error(`Array size exceeds maximum of ${MAX_ARRAY_ITEMS} items`);
        }
        
        return sanitizeParsedValue(parsed);
      } catch (error: unknown) {
        throw new Error(`Invalid YAML array: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Otherwise, parse as newline-separated items (backward compatibility)
    const lines = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, MAX_ARRAY_ITEMS); // Limit number of items
    
    // Try to parse each line as JSON, fallback to string
    const parsed = lines.map((line) => {
      try {
        const parsedLine = JSON.parse(line);
        return sanitizeParsedValue(parsedLine);
      } catch {
        // If not JSON, treat as string
        if (line.length > MAX_VALUE_STRING_LENGTH) {
          throw new Error(`Array item length exceeds maximum of ${MAX_VALUE_STRING_LENGTH} characters`);
        }
        return line;
      }
    });
    return parsed;
  }

  // Try to parse as YAML or JSON (for objects or arrays)
  try {
    // First try YAML (which can also parse JSON)
    const parsed = yaml.load(trimmed, {
      schema: yaml.JSON_SCHEMA, // Use JSON-compatible schema for safety
    });
    
    // Additional sanitization pass
    return sanitizeParsedValue(parsed);
  } catch (yamlError: unknown) {
    // If YAML fails, try JSON with security checks
    try {
      const parsed = JSON.parse(trimmed, (key, value) => {
        // Block __proto__, constructor, and prototype keys
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          return undefined; // Remove these keys
        }
        return value;
      });
      
      // Additional sanitization pass
      return sanitizeParsedValue(parsed);
    } catch (jsonError: unknown) {
      // If not valid YAML or JSON, return as string
      if (trimmed.length > MAX_VALUE_STRING_LENGTH) {
        throw new Error(`String length exceeds maximum of ${MAX_VALUE_STRING_LENGTH} characters`);
      }
      return trimmed;
    }
  }
}

/**
 * Format a value for display (YAML format for complex objects, plain text for primitives)
 */
export function formatValueForDisplay(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  if (typeof value === 'string') {
    return value;
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  
  // For arrays and objects, use YAML format (more readable than JSON)
  try {
    return yaml.dump(value, {
      indent: 2,
      lineWidth: 80,
      noRefs: true,
      flowLevel: -1, // Never use flow style (inline arrays/objects)
    });
  } catch {
    // Fallback to string representation
    return String(value);
  }
}

/**
 * Type guard to check if a value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Type guard to check if a value is an object (but not an array or null)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates metadata object for safety before saving
 * Checks size limits, key validity, and prevents prototype pollution
 * 
 * @throws {Error} If metadata is invalid or unsafe
 */
export function validateMetadata(metadata: unknown): metadata is Record<string, unknown> {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error('Metadata must be a plain object');
  }

  const obj = metadata as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length > 1000) {
    throw new Error('Metadata cannot contain more than 1000 fields');
  }

  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new Error('All metadata keys must be strings');
    }
    if (key.length === 0) {
      throw new Error('Metadata keys cannot be empty');
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`Key "${key}" exceeds maximum length of ${MAX_KEY_LENGTH} characters`);
    }
    // Prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`Invalid key detected: "${key}"`);
    }

    // Validate value
    try {
      sanitizeParsedValue(obj[key]);
    } catch (error: unknown) {
      throw new Error(`Invalid value for key "${key}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return true;
}
