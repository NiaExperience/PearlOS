// Server wrapper component. AuthProvider is a server component; client context providers
// are moved into a separate client-side module to avoid importing a 'use server' file
// inside a 'use client' module, which was triggering build errors.
import type { GlobalSettings } from '@nia/features';
import { GlobalSettingsActions } from '@nia/prism/core/actions';

import { getLogger } from '@interface/lib/logger';
import { AuthProvider } from '@interface/providers/auth-provider';
import { ClientProviders } from '@interface/providers/client-providers';
import { GlobalSettingsProvider } from '@interface/providers/global-settings-provider';

function shouldSkipGlobalSettingsFetch(): boolean {
  if (typeof process === 'undefined') {
    return false;
  }

  const flag = process.env.PRISM_SKIP_REMOTE_FETCH || process.env.NIA_SKIP_REMOTE_FETCH;
  if (flag && ['1', 'true', 'yes'].includes(flag.toLowerCase())) {
    return true;
  }

  const lifecycleEvent = process.env.npm_lifecycle_event?.toLowerCase();
  if (lifecycleEvent === 'build') {
    return true;
  }

  const nextPhase = process.env.NEXT_PHASE;
  if (nextPhase === 'phase-production-build') {
    return true;
  }

  return false;
}

const FALLBACK_GLOBAL_SETTINGS: Partial<GlobalSettings> | null = null;

export async function Providers({ children }: { children: React.ReactNode }) {
  const log = getLogger('Providers');
  let globalSettings: Partial<GlobalSettings> | null = FALLBACK_GLOBAL_SETTINGS;
  if (shouldSkipGlobalSettingsFetch()) {
    log.warn('Skipping global settings fetch (remote IO disabled)');
  } else {
    try {
      const settings = await GlobalSettingsActions.getGlobalSettings();
      globalSettings = settings ?? FALLBACK_GLOBAL_SETTINGS;
    } catch (error) {
      log.error('Failed to load global settings, defaulting to fallback', {
        error,
      });
    }
  }

  return (
    <AuthProvider>
      <GlobalSettingsProvider value={globalSettings}>
        <ClientProviders>
          {children}
        </ClientProviders>
      </GlobalSettingsProvider>
    </AuthProvider>
  );
}
