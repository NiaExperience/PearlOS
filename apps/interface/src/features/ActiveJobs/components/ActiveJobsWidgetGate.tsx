'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ActiveJobsWidget } from './ActiveJobsWidget';

const HIDDEN_ROUTES = new Set(['/login', '/signup', '/terminal', '/the-agency']);

/**
 * Renders the jobs pill only outside auth entry routes so login/signup stay clean.
 */
export function ActiveJobsWidgetGate() {
  const pathname = usePathname();
  const [openWindowSources, setOpenWindowSources] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const handleWindowsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; viewTypes?: string[] }>).detail;
      const source = detail?.source || 'legacy';
      const viewTypes = Array.isArray(detail?.viewTypes) ? detail.viewTypes : [];
      setOpenWindowSources((prev) => ({ ...prev, [source]: viewTypes }));
    };
    window.addEventListener('pearlos:open-windows-changed', handleWindowsChanged);
    return () => window.removeEventListener('pearlos:open-windows-changed', handleWindowsChanged);
  }, []);

  const agencyOpen = Object.values(openWindowSources).some((viewTypes) => viewTypes.includes('agency'));

  if (!pathname || HIDDEN_ROUTES.has(pathname) || pathname.endsWith('/terminal') || agencyOpen) {
    return null;
  }
  return <ActiveJobsWidget />;
}
