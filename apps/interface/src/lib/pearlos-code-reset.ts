import type { PearlOSUserPreferences } from '@interface/lib/pearlos-user-preferences';

export const PEARLOS_CODE_RESET_KEYS = [
  'interfaceCustomization',
  'personalChangeLedger',
  'personalFeaturePackages',
  'installedCommunityFeatures',
] as const;

export function defaultPearlOSCodeSettings(now = Date.now()): Partial<PearlOSUserPreferences> {
  return {
    interfaceCustomization: {
      theme: 'pixel',
      backgrounds: {
        home: '/backgrounds/home-sunset.png',
        desktop: '/backgrounds/desktop-forest.png',
      },
      icons: {},
      customThemes: [],
      updatedAt: now,
    },
    personalChangeLedger: [],
    personalFeaturePackages: [],
    installedCommunityFeatures: {},
  };
}
