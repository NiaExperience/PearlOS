import { IDynamicContent } from '../blocks/dynamicContent.block';

import { AccountDefinition } from "./Account.definition";
import { AnonymousUserDefinition } from "./AnonymousUser.definition";
import { AssistantDefinition } from "./Assistant.definition";
import { AssistantFeedbackDefinition } from "./AssistantFeedback.definition";
import { AssistantThemeDefinition } from "./AssistantTheme.definition";
import { FunctionalPromptDefinition } from "./FunctionalPrompt.definition";
import { GlobalSettingsDefinition } from './GlobalSettings.definition';
import { LinkMapDefinition } from './LinkMapDefinition';
import { OrganizationDefinition } from "./Organization.definition";
import { PersonalityDefinition } from "./Personality.definition";
import { ResetPasswordTokenDefinition } from "./ResetPasswordToken.definition";
import { ResourceShareTokenDefinition } from "./ResourceShareToken.definition";
import { SpriteDefinition } from "./Sprite.definition";
import { TenantDefinition } from "./Tenant.definition";
import { ToolDefinition } from "./Tool.definition";
import { UserDefinition } from "./User.definition";
import { UserOrganizationRoleDefinition } from "./UserOrganizationRole.definition";
import { UserProfileDefinition } from './UserProfile.definition';
import { UserTenantRoleDefinition } from "./UserTenantRole.definition";

// Export individual definitions
export { FunctionalPromptDefinition } from './FunctionalPrompt.definition';
export { UserProfileDefinition } from './UserProfile.definition';
export { GlobalSettingsDefinition } from './GlobalSettings.definition';
export { SpriteDefinition } from './Sprite.definition';

// Merge legacy auto-generated definitions with new isolated files.
export const platformDefinitionsIndex: Record<string, IDynamicContent> = {
    Account: AccountDefinition,
    AnonymousUser: AnonymousUserDefinition,
    Assistant: AssistantDefinition,
    AssistantFeedback: AssistantFeedbackDefinition,
    AssistantTheme: AssistantThemeDefinition,
    FunctionalPrompt: FunctionalPromptDefinition,
    Organization: OrganizationDefinition,
    Personality: PersonalityDefinition,
    ResetPasswordToken: ResetPasswordTokenDefinition,
    ResourceShareToken: ResourceShareTokenDefinition,
    Sprite: SpriteDefinition,
    Tenant: TenantDefinition,
    Tool: ToolDefinition,
    User: UserDefinition,
    UserOrganizationRole: UserOrganizationRoleDefinition,
    UserProfile: UserProfileDefinition,
    UserTenantRole: UserTenantRoleDefinition,
    GlobalSettings: GlobalSettingsDefinition,
    LinkMap: LinkMapDefinition,
};
