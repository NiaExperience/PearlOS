import React from 'react';
import type { DynamicContentUIConfig } from '../../blocks/dynamicContent.block';
import { JSONProperties } from '../../content/types';
import { getFieldDisplayName, formatFieldValue, getContentFieldRoles } from '../../content/client-utils';
import { getLogger } from '../../logger';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';

interface ContentCardProps {
  item: Record<string, unknown>;
  fields: JSONProperties;
  assistantName?: string;
  isCard?: boolean;
  onClick?: () => void;
  uiConfig: DynamicContentUIConfig;
  debug?: boolean;
}

export function ContentCard({ item, fields, assistantName, isCard = true, onClick, uiConfig, debug }: ContentCardProps) {
  const logger = React.useMemo(() => getLogger('prism:components:content-card'), []);
  const seatrade = assistantName === 'seatrade' || assistantName === 'paddytest' || assistantName === 'seatrade-jdx';

  const {
    imageField,
    titleField,
    descriptionField,
    tagField,
    linkField,
  } = getContentFieldRoles(fields, uiConfig);

  const imageUrl = imageField ? (item[imageField] as string) : undefined;
  const title = titleField ? formatFieldValue(item[titleField], fields[titleField]) : undefined;
  const description = descriptionField ? formatFieldValue(item[descriptionField], fields[descriptionField]) : undefined;
  const tags = tagField && Array.isArray(item[tagField]) ? (item[tagField] as string[]) : undefined;
  const link = linkField ? (item[linkField] as string) : undefined;

  const displayFields = (isCard ? uiConfig!.listView!.displayFields : uiConfig!.detailView!.displayFields) || []

  const cardClass = `hover:shadow-md transition-shadow cursor-pointer min-w-0 w-full bg-white text-black ${!isCard ? 'max-w-2xl mx-auto' : ''} ${onClick ? 'hover:ring-2 ring-blue-300' : ''}`;
  if (debug) {
    logger.debug('Rendering content card', {
      title,
      cardClass,
      isCard,
      hasItem: Boolean(item),
    });
  }
  return (
    <Card
      className={cardClass}
      onClick={onClick}
      style={undefined}
    >
      <CardHeader className="pb-0">
        {/* Image/logo - only render if imageField is defined */}
        {imageField && (
          <div className="flex justify-center mb-4">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={title || 'Image'}
                className="h-32 w-full object-cover object-center opacity-90 rounded-t-lg"
              />
            ) : (
              <div className="h-32 w-full flex items-center justify-center bg-gray-300 dark:bg-gray-600 rounded-t-lg">
                {seatrade ? (
                  <img src='/images/Seatrade_Logo_vertical_black.png' alt='Seatrade' className="w-[70%] h-[70%] object-contain opacity-90 object-center p-6" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-600" />
                )}
              </div>
            )}
          </div>
        )}
        {/* Title */}
        {title && (
          <CardTitle className={`text-lg ${seatrade ? 'text-center text-[--scg-navy]' : 'text-gray-900'} dark:text-white`}>{title}</CardTitle>
        )}
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex flex-col gap-1 mb-2">
          {displayFields.map((key) => {
            const val = item[key];
            if (val && typeof val === 'object' && 'type' in val) {
              logger.warn('Suspicious object with type key', { key, valueType: typeof val });
              return null;
            }
            return item[key] ? (
              <div key={key} className="text-sm text-gray-600 dark:text-gray-300">
                <span className="font-bold text-gray-800 mr-2">{getFieldDisplayName(key)}:</span>
                <span className="text-gray-800 mr-2">{formatFieldValue(item[key], fields[key])}</span>
              </div>
            ) : null;
          })}
        </div>
        {/* Description */}
        {description && (
          <CardDescription className={`${isCard ? 'text-sm line-clamp-3' : 'whitespace-pre-line'} my-4`}>{description}</CardDescription>
        )}
        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-2 my-2">
            {tags.map((tag, idx) => (
              <span key={idx} className="bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
      </CardContent>
      {link && (
        <CardFooter>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={`${seatrade ? 'text-center text-[--scg-sunset]' : 'text-blue-500 hover:text-blue-600'} ${isCard ? 'text-sm mt-2' : 'mt-4'} block`}
          >
            {seatrade ? 'Show' : 'Tell'} me more →
          </a>
        </CardFooter>
      )}
    </Card>
  );
} 