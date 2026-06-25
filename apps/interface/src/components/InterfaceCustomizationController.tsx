'use client';

import { useEffect } from 'react';

import {
  NIA_EVENT_INTERFACE_CUSTOMIZE,
  applyInterfaceCustomization,
  applyInterfaceCustomizePayload,
  readInterfaceCustomization,
  type InterfaceCustomizePayload,
} from '@interface/lib/interface-customization';
import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('[interface_customization]');

function extractPayload(detail: unknown): InterfaceCustomizePayload | undefined {
  if (!detail || typeof detail !== 'object') return undefined;
  const record = detail as Record<string, unknown>;
  if (record.payload && typeof record.payload === 'object') {
    return record.payload as InterfaceCustomizePayload;
  }
  return record as InterfaceCustomizePayload;
}

export default function InterfaceCustomizationController() {
  useEffect(() => {
    applyInterfaceCustomization(readInterfaceCustomization());

    const handleCustomize = (event: Event) => {
      const payload = extractPayload((event as CustomEvent).detail);
      if (!payload) return;

      applyInterfaceCustomizePayload(payload).catch((error) => {
        log.error('Failed to apply interface customization', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    window.addEventListener(NIA_EVENT_INTERFACE_CUSTOMIZE, handleCustomize);
    return () => {
      window.removeEventListener(NIA_EVENT_INTERFACE_CUSTOMIZE, handleCustomize);
    };
  }, []);

  return null;
}
