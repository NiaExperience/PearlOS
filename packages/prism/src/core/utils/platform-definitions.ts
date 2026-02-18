import { IDynamicContent } from '../blocks/dynamicContent.block';
import { platformDefinitionsIndex } from '../platform-definitions';
import { Prism } from '../../prism';
import { getLogger } from '../logger';

const logger = getLogger('prism:platform-definitions');

// Function to create platform content definitions
export async function createPlatformContentDefinitions() {
  const prism = await Prism.getInstance();
  const definitions = Object.values(platformDefinitionsIndex);

  for (const definition of definitions) {
    try {
      if (!definition || !definition.name) {
        logger.warn('Skipping invalid definition', { definition });
        continue;
      }
      const result = await prism.createDefinition(definition as IDynamicContent);
      if (!result) {
        logger.error('Failed to create dynamic content definition', {
          definitionName: (definition as IDynamicContent).name,
        });
      }
    } catch (error) {
      logger.error('Error creating dynamic content definition', {
        definitionName: (definition as IDynamicContent).name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function isPlatformContentDefinition(contentType: string) {
  return Object.keys(platformDefinitionsIndex).includes(contentType) ||
  contentType === 'DynamicContent';
}

export function getPlatformContentDefinition(contentType: string) {
  return platformDefinitionsIndex[contentType as keyof typeof platformDefinitionsIndex];
}