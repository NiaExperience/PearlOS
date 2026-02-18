const LOGIN_FEATURE_KEYS = new Set(['googleAuth', 'guestLogin', 'passwordLogin']);

export type AssistantAccessFeatures = {
  allowAnonymousLogin?: boolean | null;
  supportedFeatures?: unknown;
};

export type AssistantLoginFeatureState = {
  guestAllowed: boolean;
  supportedList: string[];
  hasLoginFeatureSelection: boolean;
  guestFeatureExplicitlyEnabled: boolean;
};

export function getAssistantLoginFeatureState(
  assistant: AssistantAccessFeatures,
): AssistantLoginFeatureState {
  const rawSupported = Array.isArray(assistant.supportedFeatures)
    ? assistant.supportedFeatures
    : [];

  const supportedList = rawSupported.filter((item): item is string => typeof item === 'string');
  const hasLoginFeatureSelection = supportedList.some(feature => LOGIN_FEATURE_KEYS.has(feature));
  const guestFeatureExplicitlyEnabled = hasLoginFeatureSelection
    ? supportedList.includes('guestLogin')
    : true;

  const guestAllowed = typeof assistant.allowAnonymousLogin === 'boolean'
    ? Boolean(assistant.allowAnonymousLogin) && guestFeatureExplicitlyEnabled
    : guestFeatureExplicitlyEnabled;

  return {
    guestAllowed,
    supportedList,
    hasLoginFeatureSelection,
    guestFeatureExplicitlyEnabled,
  };
}

export function isGuestLoginAllowed(assistant: AssistantAccessFeatures): boolean {
  return getAssistantLoginFeatureState(assistant).guestAllowed;
}
