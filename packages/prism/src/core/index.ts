/**
 * Prism Core - Business Logic Layer
 * 
 * Handles:
 * - Content Actions (CRUD operations with business rules)
 * - Dynamic Content Definitions (Runtime schema management)
 * - Access Control (Role-based permissions and tenant isolation)
 * - Multi-tenancy (Sophisticated tenant-aware data access)
 */

export * from './types';
export * from './utils';
export * from './platform-definitions';
export * from './constants/kokoro-voices';
export { getAssistantLoginFeatureState, isGuestLoginAllowed } from './utils/assistant-login';
// Intentionally NOT re-exporting sendEmail here to avoid accidental client bundle inclusion of nodemailer.
// Server code should import from './email' directly.

// Functional Prompts Actions
export * as FunctionalPromptActions from './actions/functionalPrompt-actions';

// Special case, these are needed early in the test startup
export { ToolType, ToolBaseType, type ITool } from './blocks/tool.block';
export { type IUser, UserSchema, UserMessageStoreSchema } from './blocks/user.block';
export { type PersonalityVoiceConfig, type ModePersonalityVoiceConfig, VoiceProviderType } from './blocks/assistant.block';
export { 
  type IPersonalityVoiceConfig, 
  type IConversationSummary, 
  PersonalityVoiceConfigSchema, 
  ConversationSummarySchema 
} from './blocks/userProfile.block';
// PasswordSetupForm is a React component - import from '@nia/prism/core/components/PasswordSetupForm' for client builds
