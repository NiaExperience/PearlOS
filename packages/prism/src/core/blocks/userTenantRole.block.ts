import { z } from 'zod';

export const BlockType_UserTenantRole = 'UserTenantRole';

export enum TenantRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

export interface IUserTenantRole {
  _id?: string;
  userId: string; // References user page_id
  tenantId: string; // References tenant page_id
  role: TenantRole;
}

