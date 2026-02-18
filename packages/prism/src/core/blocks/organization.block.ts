import { z } from 'zod';

import { ResourceType } from './resourceShareToken.block';

export const BlockType_Organization = 'Organization';

export interface IOrganization {
  _id?: string;
  tenantId: string; // References tenant page_id
  name: string;
  description?: string;
  sharedToAllReadOnly?: boolean;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sharedResources?: Record<string, ResourceType>; // Map of resourceId -> contentType
}

export const OrganizationSchema = z.object({
  _id: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  sharedToAllReadOnly: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  sharedResources: z.record(
    z.nativeEnum(ResourceType)
  ).optional()
});
