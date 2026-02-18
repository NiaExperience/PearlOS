import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import React from 'react';
import { Suspense } from 'react';
import ToolGrid from '@dashboard/components/tool-grid';
import { ThemeToggle } from '@dashboard/components/theme-toggle';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';
import { redirect } from 'next/navigation';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const ToolsMarketplacePage = async () => {
  // Additional check for the tools marketplace page
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  
  if (!session || !session.user) {
    redirect('/login');
  }

  // Deny access to anonymous users
  if (session.user.is_anonymous) {
    redirect('/login');
  }

  // Check if user has admin access to any tenant
  const tenantRoles = await TenantActions.getUserTenantRoles(session.user.id);
  const hasAdminAccess = tenantRoles?.some(role => 
    (role.role === 'admin' || role.role === 'owner')
  ) || false;

  if (!hasAdminAccess) {
    redirect('/login');
  }

  return (
    <div className='w-full'>
      <header className='flex h-16 items-center gap-2 justify-between mr-4'>
        <div className='flex items-center gap-2 px-4'>
          <h1>Tools Marketplace</h1>
        </div>
        <ThemeToggle />
      </header>
      <div className='flex flex-1 flex-col gap-4 pt-0 justify-center items-center h-[calc(100vh-64px)] p-12'>
        <Suspense fallback={<div>Loading tools...</div>}>
          <ToolGrid />
        </Suspense>
      </div>
    </div>
  );
};

export default ToolsMarketplacePage;
