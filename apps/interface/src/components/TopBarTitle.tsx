'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export const TOPBAR_TITLE_SET_EVENT = 'topbar:title:set';
export const TOPBAR_TITLE_CLEAR_EVENT = 'topbar:title:clear';

export interface TopBarTitleSetDetail {
  title: string;
}

function titleFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname.startsWith('/launchpad')) return 'Studio';
  if (pathname.startsWith('/notes')) return 'Notes';
  if (pathname.startsWith('/settings')) return 'Settings';
  return null;
}

export function TopBarTitle() {
  const pathname = usePathname();
  const [dynamicTitle, setDynamicTitle] = useState<string | null>(null);

  useEffect(() => {
    const handleSet = (event: Event) => {
      const detail = (event as CustomEvent<TopBarTitleSetDetail>).detail;
      if (detail?.title) setDynamicTitle(detail.title);
    };
    const handleClear = () => setDynamicTitle(null);

    window.addEventListener(TOPBAR_TITLE_SET_EVENT, handleSet);
    window.addEventListener(TOPBAR_TITLE_CLEAR_EVENT, handleClear);
    return () => {
      window.removeEventListener(TOPBAR_TITLE_SET_EVENT, handleSet);
      window.removeEventListener(TOPBAR_TITLE_CLEAR_EVENT, handleClear);
    };
  }, []);

  const title = dynamicTitle ?? titleFromPathname(pathname);
  if (!title) return null;

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-3 z-[55] -translate-x-1/2"
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <div className="flex h-9 items-center rounded-lg border border-white/10 bg-black/40 px-3 text-sm font-medium uppercase tracking-wider text-white/80 backdrop-blur-md">
        {title}
      </div>
    </div>
  );
}

export default TopBarTitle;
