// Re-export commonly used types for testing scenarios
// This avoids deep path imports in test files and globalSetup

// Block interfaces
export type { ITenant } from '../core/blocks/tenant.block';
export type { IUser } from '../core/blocks/user.block';
export type { IAssistant } from '../core/blocks/assistant.block';
export type { IAccount } from '../core/blocks/account.block';
export type { IDynamicContent } from '../core/blocks/dynamicContent.block';
export type { ITool } from '../core/blocks/tool.block';
export type { IAssistantFeedback } from '../core/blocks/assistantFeedback.block';

// Enums
export { TenantPlanTier } from '../core/blocks/tenant.block';
export { ToolType, ToolBaseType } from '../core/blocks/tool.block';
export { TenantRole } from '../core/blocks/userTenantRole.block';

// Block type constants
export { BlockType_Tenant } from '../core/blocks/tenant.block';
export { BlockType_User } from '../core/blocks/user.block';
export { BlockType_Tool } from '../core/blocks/tool.block';
