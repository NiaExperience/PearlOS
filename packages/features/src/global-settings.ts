export interface InterfaceLoginSettings {
  googleAuth: boolean;
  guestLogin: boolean;
  passwordLogin: boolean;
}

export interface GlobalSettings {
  interfaceLogin: InterfaceLoginSettings;
  denyListEmails: string[];
}

export const DEFAULT_INTERFACE_LOGIN_SETTINGS: InterfaceLoginSettings = {
  googleAuth: true,
  guestLogin: true,
  passwordLogin: true,
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  interfaceLogin: DEFAULT_INTERFACE_LOGIN_SETTINGS,
  denyListEmails: [],
};

type PartialInterfaceLogin = Partial<InterfaceLoginSettings> | null | undefined;

type PartialGlobalSettings = {
  interfaceLogin?: PartialInterfaceLogin;
  denyListEmails?: string[];
} | null | undefined;

function mergeInterfaceLogin(partial: PartialInterfaceLogin): InterfaceLoginSettings {
  return {
    ...DEFAULT_INTERFACE_LOGIN_SETTINGS,
    ...(partial ?? {}),
  };
}

export function mergeGlobalSettings(partial: PartialGlobalSettings): GlobalSettings {
  return {
    interfaceLogin: mergeInterfaceLogin(partial?.interfaceLogin),
    denyListEmails: partial?.denyListEmails ?? [],
  };
}

export function resolveInterfaceLoginSettings(settings?: PartialGlobalSettings): InterfaceLoginSettings {
  if (!settings) return DEFAULT_INTERFACE_LOGIN_SETTINGS;
  return mergeInterfaceLogin(settings.interfaceLogin);
}

export function resolveGlobalSettings(settings?: PartialGlobalSettings): GlobalSettings {
  if (!settings) return DEFAULT_GLOBAL_SETTINGS;
  return mergeGlobalSettings(settings);
}
