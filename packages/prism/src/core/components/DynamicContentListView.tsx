'use client';

import React from 'react';

import type { DynamicContentUIConfig, IDynamicContent } from '../blocks/dynamicContent.block';
import { ContentCard } from './ui/content-card';
import type { AnySchemaObject } from 'ajv/dist/types';
import { getLogger } from '../logger';

interface DynamicContentListViewProps {
  blockType: string;
  assistantName?: string;
  query?: any;
  onSelect?: (item: Record<string, unknown>) => void;
}

/**
 * DynamicContentListView
 * 
 * Fetches and displays a list of dynamic content items for a given block type and assistant.
 * Handles loading state, error state, and renders a grid of ContentCard components.
 */
export const DynamicContentListView: React.FC<DynamicContentListViewProps> = ({
  blockType,
  assistantName,
  query,
  onSelect,
}) => {
  const logger = React.useMemo(() => getLogger('prism:components:dynamic-content-list'), []);
  // State for fetched items, field definitions, and UI config
  const [items, setItems] = React.useState<Record<string, unknown>[]>([]);
  const [fields, setFields] = React.useState<{[key: string]: AnySchemaObject}>({});
  const [uiConfig, setUiConfig] = React.useState<DynamicContentUIConfig | undefined>(undefined);

  React.useEffect(() => {
    /**
     * Fetches assistant info, then fetches content list and definition for the given block type.
     * Updates state with items, fields, and UI config.
     */
    const fetchData = async () => {
      try {
        // 1. Fetch assistant info to get tenantId
        // If assistantName looks like a UUID, treat as assistantId, else as subDomain
        const isUUID = typeof assistantName === 'string' && /^[0-9a-fA-F-]{36}$/.test(assistantName);
        const assistantPayload = isUUID ? { assistantId: assistantName } : { subDomain: assistantName };
        const assistantResponse = await fetch(`/api/assistant`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(assistantPayload),
        });

        const assistant = await assistantResponse.json();
        if (!assistant || !assistant.name) {
          logger.error('Assistant not found', { assistantName });
          return;
        }

        const tenantId = assistant.tenantId;
        logger.debug('Resolved assistant for dynamic content list', {
          blockType,
          assistantId: assistant._id,
          tenantId,
        });

        // 2. Build query string for content list API
        let queryString = '';
        if (query) {
          // Properly encode the query parameter
          queryString = `&query=${encodeURIComponent(JSON.stringify(query))}`;
        }
        logger.debug('Dynamic content list query string constructed', { queryString: queryString || undefined });

        // 3. Fetch content list and definition
        const response = await fetch(
          `/api/contentList?tenantId=${tenantId}&type=${blockType}${queryString}`
        );
        const contentAndDefinition = await response.json();
        const definition = contentAndDefinition.definition as IDynamicContent;
        logger.debug('Fetched dynamic content definition', {
          blockType,
          definitionName: definition?.name,
          hasUiConfig: Boolean(definition?.uiConfig),
        });
        
        const items = contentAndDefinition.items || [];
        logger.debug('Fetched dynamic content items', { blockType, itemCount: items.length });

        // 4. Validate response and update state
        if (!contentAndDefinition.definition ) {
          logger.error('No dynamic content definition found in response', { tenantId, blockType, assistantName });
          return;
        }
        if (!definition.uiConfig ) {
          logger.error('No dynamic content uiConfig found in definition', { blockType, definitionName: definition?.name });
          return;
        }
        setItems(items);
        setFields(definition.dataModel.jsonSchema.properties || {});
        setUiConfig(definition.uiConfig as DynamicContentUIConfig);
      } catch (error) {
        logger.error('Error fetching dynamic content list', {
          error: error instanceof Error ? error.message : String(error),
          blockType,
          assistantName,
        });
      }
    };

    // Trigger fetch on mount and when dependencies change
    fetchData();
  }, [blockType, assistantName, query]);

  logger.debug('DynamicContentListView state snapshot', {
    blockType,
    itemsLoaded: items.length,
    hasFields: Object.keys(fields).length > 0,
    hasUiConfig: Boolean(uiConfig),
  });

  // Show loading state if fields or uiConfig are not ready
  if (!uiConfig || !fields || Object.keys(fields).length === 0) {
    return <div>Loading...</div>;
  }

  // Show loading if items are not yet loaded
  if (!items) return <div>Loading...</div>;
  // Show empty state if no items found
  if (items.length === 0) return <div>No content found.</div>;

  // Render grid of ContentCard components for each item
  const gridClass = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 min-w-0 w-full";
  return (
    <div className={gridClass}>
      {items.map(item => (
        <ContentCard
          key={item._id as string}
          item={item}
          fields={fields}
          uiConfig={uiConfig!}
          isCard={true}
          onClick={onSelect ? () => onSelect(item) : undefined}
          debug={true}
        />
      ))}
    </div>
  );
};
