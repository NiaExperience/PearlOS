import z from 'zod';


export const BlockType_Tenant = 'Tenant';

export enum TenantPlanTier {
  FREE = 'free',
  BASIC = 'basic',
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise',
}

export interface ITenant {
  _id?: string;
  name: string;
  domain?: string;
  description?: string; // human-readable description
  settings?: Record<string, unknown>;
  planTier?: TenantPlanTier;
}

