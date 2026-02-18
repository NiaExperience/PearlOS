"use client";
import { usePathname } from 'next/navigation';
import React from 'react';

import { TenantSelector } from '../../../components/admin/TenantSelector';
import { AdminProvider } from '../../../contexts/AdminContext';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Determine which selectors to show
  const atAdminRoot = pathname === '/dashboard/admin' || pathname === '/dashboard/admin/';
  const atTenants = pathname?.startsWith('/dashboard/admin/tenants');
  const atPersonalities = pathname?.startsWith('/dashboard/admin/personalities');
  const atUserProfiles = pathname?.startsWith('/dashboard/admin/userProfile');
  const atGlobalSettings = pathname?.startsWith('/dashboard/admin/global-settings');
  const atFunctionalPrompts = pathname?.startsWith('/dashboard/admin/functional-prompts');
  const atResourceShares = pathname?.startsWith('/dashboard/admin/resource-shares');
  const atLinkMap = pathname?.startsWith('/dashboard/admin/link-map');
  const showTenantSelector = !(
    atAdminRoot || atTenants || atPersonalities || atUserProfiles || atGlobalSettings || atFunctionalPrompts || atResourceShares || atLinkMap
  );
  return (
    <AdminProvider>
      <div className="p-6">
        <div className="flex flex-wrap gap-4 justify-between items-center border-b pb-3 mb-6">
          <h1 className="text-lg font-semibold">Admin</h1>
          <div className="flex flex-wrap gap-4 items-center">
            {showTenantSelector && <TenantSelector />}
          </div>
        </div>
        <div className="flex-1 w-full min-w-0 space-y-6">{children}</div>
      </div>
    </AdminProvider>
  );
}
