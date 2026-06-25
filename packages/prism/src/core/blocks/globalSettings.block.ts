import { z } from 'zod';

export const BlockType_GlobalSettings = 'GlobalSettings';
export const GLOBAL_SETTINGS_SINGLETON_KEY = 'platform';

export const InterfaceLoginSettingsSchema = z.object({
  googleAuth: z.boolean().default(true),
  guestLogin: z.boolean().default(true),
  passwordLogin: z.boolean().default(true),
});

export const GlobalSettingsSchema = z.object({
  _id: z.string().uuid().optional(),
  singletonKey: z.string().default(GLOBAL_SETTINGS_SINGLETON_KEY),
  interfaceLogin: InterfaceLoginSettingsSchema,
  denyListEmails: z.array(z.string().email()).default([]),
  // Google OAuth sign-in allowlist. When non-empty, only these emails may
  // complete the `google` provider sign-in path. Stored in Postgres so it can
  // be managed at runtime from the dashboard or the `allowlist:*` CLI scripts.
  // The legacy `GOOGLE_SIGNIN_ALLOWLIST` env var still works and is merged
  // (union) with this list during sign-in for backward compatibility.
  allowListEmails: z.array(z.string().email()).default([]),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type InterfaceLoginSettings = z.infer<typeof InterfaceLoginSettingsSchema>;
export type IGlobalSettings = z.infer<typeof GlobalSettingsSchema>;

export const DefaultInterfaceLoginSettings: InterfaceLoginSettings = {
  googleAuth: true,
  guestLogin: true,
  passwordLogin: true,
};

export const DefaultGlobalSettings: IGlobalSettings = {
  singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
  interfaceLogin: DefaultInterfaceLoginSettings,
  denyListEmails: [],
  allowListEmails: [],
};
