'use client';

import React from 'react';
import { getContentFieldRoles } from '../content/client-utils';
import { getLogger } from '../logger';

import { ContentCard } from './ui/content-card';
import { DynamicContentUIConfig, IDynamicContent } from '../blocks/dynamicContent.block';

interface DynamicContentDetailViewProps {
  contentId?: string;
  blockType: string;
  assistantName?: string;
  query?: any;
}

/**
 * DynamicContentDetailView
 * 
 * Fetches and displays the details of a single dynamic content item for a given block type and assistant.
 * Handles loading state, error state, and renders a ContentCard component for the item.
 */
export function DynamicContentDetailView({
  contentId,
  blockType,
  assistantName,
  query,
}: DynamicContentDetailViewProps) {
  const logger = React.useMemo(() => getLogger('prism:components:dynamic-content-detail'), []);
  // --- State Management ---
  // Holds the fetched content item
  const [item, setItem] = React.useState<Record<string, unknown>>({});
  // Holds the field definitions for the content type
  const [fields, setFields] = React.useState<{[key: string]: any}>({});
  // Holds the UI configuration for the content type
  const [uiConfig, setUiConfig] = React.useState<DynamicContentUIConfig | undefined>(undefined);

  // --- Data Fetching Effect ---
  React.useEffect(() => {
    /**
     * Fetches assistant info, then fetches content detail and definition for the given block type and contentId.
     * Updates state with item, fields, and UI config.
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

        if (!assistantResponse.ok) {
          logger.error('Assistant API error', { status: assistantResponse.status, assistantPayload });
          return;
        }

        const assistant = await assistantResponse.json();
        if (!assistant || !assistant.name) {
          logger.error('Assistant not found', { assistantName });
          return;
        }
        const tenantId = assistant.tenantId;

        // 2. Build query for content detail API, injecting contentId if provided
        let finalQuery = query;
        if (contentId) {
          // If contentId is provided, inject it into the query
          const inject = { page_id: contentId };
          finalQuery = { ...query, ...inject };
        }
        let queryString = '';
        if (finalQuery) {
          // Properly encode the query parameter
          queryString = `&query=${encodeURIComponent(JSON.stringify(finalQuery))}`;
        }

        // 3. Fetch content detail and definition
        const response = await fetch(
          `/api/contentDetail?tenantId=${tenantId}&type=${blockType}${queryString}`
        );

        if (!response.ok) {
          logger.error('Content detail API error', { status: response.status, tenantId, blockType });
          return;
        }

        const contentAndDefinition = await response.json();
        const definition = contentAndDefinition.definition as IDynamicContent;
        const item = contentAndDefinition.item || {};

        // 4. Validate response and update state
        if (!contentAndDefinition.definition) {
          logger.error('No dynamic content definition found in response', { tenantId, blockType, assistantName });
          return;
        }
        if (!definition.uiConfig) {
          logger.error('No dynamic content uiConfig found in definition', { blockType, definitionName: definition.name });
          return;
        }
        setItem(item);
        setFields(definition.dataModel.jsonSchema.properties || {});
        setUiConfig(definition.uiConfig!);
      } catch (error) {
        logger.error('Error fetching dynamic content', {
          error: error instanceof Error ? error.message : String(error),
          blockType,
          assistantName,
        });
      }
    };

    // Trigger fetch on mount and when dependencies change
    fetchData();
  }, [blockType, assistantName, query, contentId]);

  // --- Field Roles Extraction ---
  // Extracts extraFields and other roles from the field definitions and UI config
  const { extraFields } = getContentFieldRoles(fields, uiConfig);

  // --- Loading State Handling ---
  // Show loading state if fields or uiConfig are not ready
  if (!uiConfig || !fields || Object.keys(fields).length === 0) {
    return <div>Loading...</div>;
  }

  // --- Render Content Detail ---
  // Render the ContentCard for the fetched item
  return (
    <ContentCard item={item} fields={fields} isCard={false} uiConfig={uiConfig!} />
  );
}