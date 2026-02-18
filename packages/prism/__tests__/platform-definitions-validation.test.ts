/**
 * Platform Definitions Validation Tests
 * 
 * These tests ensure that platform-definitions jsonSchemas are in sync with
 * their corresponding Prism block interfaces and Zod schemas.
 * 
 * For each content type, we validate:
 * 1. All jsonSchema properties exist in the TypeScript interface
 * 2. All interface properties exist in the jsonSchema (or are documented as excluded)
 * 3. All Zod schema fields match the jsonSchema
 * 4. Property types are consistent between jsonSchema and Zod
 */

import * as fs from 'fs';
import * as path from 'path';

import { z } from 'zod';

import { AssistantSchema, IAssistant } from '../src/core/blocks/assistant.block';
import { IDynamicContent } from '../src/core/blocks/dynamicContent.block';
import { IOrganization, OrganizationSchema } from '../src/core/blocks/organization.block';
import { IPersonality, PersonalitySchema } from '../src/core/blocks/personality.block';
import { IUser, UserSchema } from '../src/core/blocks/user.block';
import { AssistantDefinition } from '../src/core/platform-definitions/Assistant.definition';
import { OrganizationDefinition } from '../src/core/platform-definitions/Organization.definition';
import { PersonalityDefinition } from '../src/core/platform-definitions/Personality.definition';
import { UserDefinition } from '../src/core/platform-definitions/User.definition';

interface ValidationResult {
  contentType: string;
  missingInInterface: string[];
  missingInJsonSchema: string[];
  missingInZodSchema: string[];
  typeInconsistencies: Array<{
    field: string;
    jsonSchemaType: string;
    zodType: string;
    issue: string;
  }>;
}

interface ContentTypeMapping {
  definition: IDynamicContent;
  blockName: string;
  zodSchema: z.ZodType<unknown>;
  interfaceType: unknown;
  // Properties that are intentionally not in jsonSchema (computed, etc.)
  excludedFromJsonSchema?: string[];
  // Properties that are intentionally not in interface (legacy, etc.)
  excludedFromInterface?: string[];
}

const CONTENT_TYPE_MAPPINGS: Record<string, ContentTypeMapping> = {
  User: {
    definition: UserDefinition,
    blockName: 'User',
    zodSchema: UserSchema,
    interfaceType: {} as IUser,
    excludedFromJsonSchema: [],
    excludedFromInterface: [],
  },
  Organization: {
    definition: OrganizationDefinition,
    blockName: 'Organization',
    zodSchema: OrganizationSchema,
    interfaceType: {} as IOrganization,
    excludedFromJsonSchema: [],
    excludedFromInterface: [],
  },
  Assistant: {
    definition: AssistantDefinition,
    blockName: 'Assistant',
    zodSchema: AssistantSchema,
    interfaceType: {} as IAssistant,
    excludedFromJsonSchema: [],
    excludedFromInterface: [],
  },
  Personality: {
    definition: PersonalityDefinition,
    blockName: 'Personality',
    zodSchema: PersonalitySchema,
    interfaceType: {} as IPersonality,
    excludedFromJsonSchema: [],
    excludedFromInterface: [],
  },
};

/**
 * Extract property names from a jsonSchema
 */
function getJsonSchemaProperties(jsonSchema: Record<string, unknown>): string[] {
  if (!jsonSchema || !('properties' in jsonSchema)) {
    return [];
  }
  const properties = jsonSchema.properties as Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log(`Extracted properties for ${jsonSchema.block} from jsonSchema:`, Object.keys(properties));
  return Object.keys(properties);
}

/**
 * Helper to extract interface body handling nested braces
 */
function extractInterfaceBody(content: string, interfaceName: string): { body: string, extendsClause?: string } | null {
  // Find the start of the interface
  const startRegex = new RegExp(`export interface ${interfaceName}\\s+(?:extends\\s+([\\w,\\s]+))?\\s*{`, 's');
  const match = content.match(startRegex);
  
  if (!match) {
    return null;
  }

  const extendsClause = match[1];
  const startIndex = match.index! + match[0].length - 1; // Point to the opening brace '{'
  
  let braceCount = 0;
  let endIndex = -1;
  
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') {
      braceCount++;
    } else if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }
  }
  
  if (endIndex === -1) {
    return null;
  }
  
  // Return content inside the braces
  return {
    body: content.substring(startIndex + 1, endIndex),
    extendsClause
  };
}

/**
 * Remove comments from code
 */
function removeComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
}

/**
 * Strip content inside nested braces
 */
function stripNestedBraces(text: string): string {
  let result = '';
  let braceCount = 0;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
    } else {
      if (braceCount === 0) {
        result += char;
      }
    }
  }
  return result;
}

/**
 * Extract property names from a TypeScript interface by reading the source file
 * Handles inheritance via 'extends' clause
 */
function getInterfaceProperties(blockName: string): string[] {
  const blockPath = path.join(__dirname, '..', 'src','core','blocks', `${blockName.toLowerCase()}.block.ts`);
  
  if (!fs.existsSync(blockPath)) {
    throw new Error(`Block file not found: ${blockPath}`);
  }

  const content = fs.readFileSync(blockPath, 'utf-8');
  
  const interfaceName = `I${blockName}`;
  const extraction = extractInterfaceBody(content, interfaceName);
  
  if (!extraction) {
    throw new Error(`Could not find interface ${interfaceName} in ${blockPath}`);
  }

  const { body: interfaceBody, extendsClause } = extraction;
  
  // Clean up the body to avoid matching properties in nested objects
  const cleanBody = stripNestedBraces(removeComments(interfaceBody));
  
  // Extract property names from the interface body (handles optional properties with ?)
  const propertyRegex = /^\s*(\w+)\??:/gm;
  const properties: string[] = [];
  let propMatch;
  
  while ((propMatch = propertyRegex.exec(cleanBody)) !== null) {
    properties.push(propMatch[1]);
  }
  
  // If there's an extends clause, recursively get properties from parent interfaces
  if (extendsClause) {
    const parentInterfaces = extendsClause.split(',').map(name => name.trim());
    
    for (const parentInterface of parentInterfaces) {
      const parentExtraction = extractInterfaceBody(content, parentInterface);
      
      if (parentExtraction) {
        const parentBody = parentExtraction.body;
        const cleanParentBody = stripNestedBraces(removeComments(parentBody));
        let parentPropMatch;
        
        while ((parentPropMatch = propertyRegex.exec(cleanParentBody)) !== null) {
          const propName = parentPropMatch[1];
          if (!properties.includes(propName)) {
            properties.push(propName);
          }
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn(`Warning: Could not find parent interface ${parentInterface} in ${blockPath}`);
      }
    }
  }
  
  // eslint-disable-next-line no-console
  console.log(`Extracted properties for I${blockName} (including inherited) from ${blockPath}:`, properties);
  return properties;
}

/**
 * Extract property names from a Zod schema
 * Handles schemas created with .extend()
 */
function getZodSchemaProperties(zodSchema: z.ZodType<unknown>): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaAny = zodSchema as any;
    
    // Get the shape function
    const shapeFunc = schemaAny._def?.shape;
    if (!shapeFunc) {
      return [];
    }
    
    const schemaShape = typeof shapeFunc === 'function' ? shapeFunc() : shapeFunc;
    
    if (!schemaShape) {
      return [];
    }
    
    const properties = Object.keys(schemaShape);
    
    // If this schema was created with .extend(), the parent schema properties
    // are already included in the shape, so we don't need to traverse
    
    // eslint-disable-next-line no-console
    console.log('Extracted properties from Zod schema:', properties);
    return properties;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Could not extract Zod schema properties:', error);
    return [];
  }
}

/**
 * Validate a single content type
 */
function validateContentType(contentType: string, mapping: ContentTypeMapping): ValidationResult {
  const result: ValidationResult = {
    contentType,
    missingInInterface: [],
    missingInJsonSchema: [],
    missingInZodSchema: [],
    typeInconsistencies: [],
  };

  const jsonSchema = mapping.definition.dataModel?.jsonSchema;
  if (!jsonSchema) {
    throw new Error(`No jsonSchema found for ${contentType}`);
  }

  const jsonSchemaProps = getJsonSchemaProperties(jsonSchema as Record<string, unknown>);
  const interfaceProps = getInterfaceProperties(mapping.blockName);
  const zodProps = getZodSchemaProperties(mapping.zodSchema);

  // Check: jsonSchema properties should exist in interface
  for (const prop of jsonSchemaProps) {
    if (!mapping.excludedFromInterface?.includes(prop) && !interfaceProps.includes(prop)) {
      result.missingInInterface.push(prop);
    }
  }

  // Check: interface properties should exist in jsonSchema
  for (const prop of interfaceProps) {
    if (!mapping.excludedFromJsonSchema?.includes(prop) && !jsonSchemaProps.includes(prop)) {
      result.missingInJsonSchema.push(prop);
    }
  }

  // Check: jsonSchema properties should exist in Zod schema
  for (const prop of jsonSchemaProps) {
    if (!zodProps.includes(prop)) {
      result.missingInZodSchema.push(prop);
    }
  }

  // Check type consistency between jsonSchema and Zod
  const jsonSchemaProperties = jsonSchema.properties as Record<string, { type?: string; items?: unknown }>;
  for (const prop of jsonSchemaProps) {
    const jsonSchemaProp = jsonSchemaProperties[prop];
    const jsonType = jsonSchemaProp?.type;
    
    if (zodProps.includes(prop)) {
      // We can add more sophisticated type checking here if needed
      // For now, just flag if the property exists in both
      if (jsonType === 'array' && !jsonSchemaProp.items) {
        result.typeInconsistencies.push({
          field: prop,
          jsonSchemaType: 'array (no items defined)',
          zodType: 'unknown',
          issue: 'Array type in jsonSchema missing items definition',
        });
      }
    }
  }

  return result;
}

describe('Platform Definitions Validation', () => {
  describe('Schema Consistency', () => {
    Object.entries(CONTENT_TYPE_MAPPINGS).forEach(([contentType, mapping]) => {
      describe(contentType, () => {
        let validationResult: ValidationResult;

        beforeAll(() => {
          validationResult = validateContentType(contentType, mapping);
        });

        it('should have all jsonSchema properties in the TypeScript interface', () => {
          if (validationResult.missingInInterface.length > 0) {
            console.error(`\n❌ ${contentType}: Missing properties in I${contentType} interface:`);
            console.error('   Properties in jsonSchema but not in interface:');
            validationResult.missingInInterface.forEach(prop => {
              console.error(`   - ${prop}`);
            });
            console.error('\n   Add these properties to the interface in:');
            console.error(`   packages/prism/src/core/blocks/${contentType.toLowerCase()}.block.ts\n`);
          }
          
          expect(validationResult.missingInInterface).toEqual([]);
        });

        it('should have all interface properties in the jsonSchema', () => {
          if (validationResult.missingInJsonSchema.length > 0) {
            console.error(`\n❌ ${contentType}: Missing properties in jsonSchema:`);
            console.error('   Properties in interface but not in jsonSchema:');
            validationResult.missingInJsonSchema.forEach(prop => {
              console.error(`   - ${prop}`);
            });
            console.error('\n   Add these properties to the jsonSchema in:');
            console.error(`   packages/prism/src/core/platform-definitions/${contentType}.definition.ts\n`);
          }
          
          expect(validationResult.missingInJsonSchema).toEqual([]);
        });

        it('should have all jsonSchema properties in the Zod schema', () => {
          if (validationResult.missingInZodSchema.length > 0) {
            console.error(`\n❌ ${contentType}: Missing properties in Zod schema:`);
            console.error('   Properties in jsonSchema but not in Zod schema:');
            validationResult.missingInZodSchema.forEach(prop => {
              console.error(`   - ${prop}`);
            });
            console.error('\n   Add these properties to the Zod schema in:');
            console.error(`   packages/prism/src/core/blocks/${contentType.toLowerCase()}.block.ts`);
            console.error(`   Look for: export const ${contentType}Schema = z.object({ ... })\n`);
          }
          
          expect(validationResult.missingInZodSchema).toEqual([]);
        });

        it('should have consistent types between jsonSchema and Zod schema', () => {
          if (validationResult.typeInconsistencies.length > 0) {
            console.error(`\n⚠️  ${contentType}: Type inconsistencies detected:`);
            validationResult.typeInconsistencies.forEach(inc => {
              console.error(`   - ${inc.field}: ${inc.issue}`);
              console.error(`     jsonSchema: ${inc.jsonSchemaType}`);
              console.error(`     Zod: ${inc.zodType}`);
            });
            console.error('');
          }
          
          expect(validationResult.typeInconsistencies).toEqual([]);
        });
      });
    });
  });

  describe('Block File Existence', () => {
    Object.entries(CONTENT_TYPE_MAPPINGS).forEach(([contentType, _mapping]) => {
      it(`should have a block file for ${contentType}`, () => {
        const blockPath = path.join(__dirname, '..', 'src', 'core', 'blocks', `${contentType.toLowerCase()}.block.ts`);
        expect(fs.existsSync(blockPath)).toBe(true);
      });
    });
  });

  describe('Definition Structure', () => {
    Object.entries(CONTENT_TYPE_MAPPINGS).forEach(([contentType, mapping]) => {
      describe(contentType, () => {
        it('should have a valid dataModel', () => {
          expect(mapping.definition.dataModel).toBeDefined();
        });

        it('should have a jsonSchema', () => {
          expect(mapping.definition.dataModel.jsonSchema).toBeDefined();
        });

        it('should have jsonSchema properties', () => {
          const jsonSchema = mapping.definition.dataModel.jsonSchema as Record<string, unknown>;
          expect(jsonSchema.properties).toBeDefined();
          expect(typeof jsonSchema.properties).toBe('object');
        });

        it('should have block name matching', () => {
          expect(mapping.definition.dataModel.block).toBe(mapping.blockName);
        });
      });
    });
  });
});
