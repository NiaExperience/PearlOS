export type { FeatureKey } from './feature-flags';
export { FeatureKeys, featureRegistry, featureFlags, envIsFeatureEnabled, isFeatureEnabled, guardFeature, featureDefinitions, setAssistantSupportedFeatures, getFeatureKeysWithPrompts } from './feature-flags';
export { default } from './feature-flags';
export { composeUserPrompt, composeSystemPrompt, ALL_REGISTERED_TOOLS, getAllRegisteredTools, getBotToolNames, getBotToolsByFeature, getBotToolFeatures, isBotTool, getBotToolMetadata, getManifestMetadata } from './featurePrompts';
export type { PersonalityModel, TemplateVars, RegisteredToolName } from './featurePrompts';
export {
	DEFAULT_GLOBAL_SETTINGS,
	DEFAULT_INTERFACE_LOGIN_SETTINGS,
	mergeGlobalSettings,
	resolveGlobalSettings,
	resolveInterfaceLoginSettings,
} from './global-settings';
export type { GlobalSettings, InterfaceLoginSettings } from './global-settings';
export { STEALTH_USER_ID } from './constants';

// Export generated content definitions
export * from './generated/definitions';

// Export bot tools registry
export * from './botToolsRegistry';

// Export creation engine templates
export * from './templates';
