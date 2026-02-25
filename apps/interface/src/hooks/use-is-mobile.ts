import { useContext } from 'react';
import { LayoutModeContext } from '@interface/contexts/layout-mode-context';
import { useIsMobileDevice } from '@interface/hooks/use-is-mobile-device';

// Re-export for convenience
export { useIsMobileDevice } from '@interface/hooks/use-is-mobile-device';

/**
 * Override-aware mobile detection.
 * If LayoutModeProvider is present, respects the layout override (desktop/mobile/auto).
 * Otherwise falls back to raw device detection.
 */
export function useIsMobile(): boolean {
  const layoutContext = useContext(LayoutModeContext);
  const deviceIsMobile = useIsMobileDevice();

  if (layoutContext) {
    return layoutContext.effectiveIsMobile;
  }

  return deviceIsMobile;
}
