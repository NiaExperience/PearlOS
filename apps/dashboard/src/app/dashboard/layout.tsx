import { TenantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { redirect } from 'next/navigation';
import React from 'react';
import { headers } from 'next/headers';

import { AppSidebar } from '../../components/app-sidebar';
import { SidebarProvider } from '../../components/ui/sidebar';
import { UserProvider } from '../../contexts/user.context';
import { dashboardAuthOptions } from '../../lib/auth-config';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const DashboardLayout = async ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  const headersList = await headers();
  const pathname = headersList.get('x-dashboard-pathname');
  if (pathname === '/dashboard/login') {
    return <>{children}</>;
  }

  // Skip auth only when DISABLE_DASHBOARD_AUTH=true (never auto-bypass by host).
  const disableAuth = process.env.DISABLE_DASHBOARD_AUTH === 'true';
  
  if (disableAuth) {
    console.log('🔓 Dashboard auth disabled for local development - allowing access');
    return (
      <UserProvider>
        <SidebarProvider defaultOpen={false}>
          <AppSidebar />
          {children}
        </SidebarProvider>
      </UserProvider>
    );
  }

  // Check authentication and admin access
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  
  console.log('🔍 Dashboard Layout - Session check:', {
    hasSession: !!session,
    hasUser: !!session?.user,
    userId: session?.user?.id,
    isAnonymous: session?.user?.is_anonymous,
    email: session?.user && 'email' in session.user ? session.user.email : undefined
  });
  
  if (!session || !session.user) {
    console.log('🔍 Dashboard Layout - No session, redirecting to login');
    redirect('/dashboard/login');
  }

  // Deny access to anonymous users
  if (session.user.is_anonymous) {
    console.log('🔍 Dashboard Layout - Anonymous user, redirecting to unauthorized');
    redirect('/dashboard/unauthorized');
  }

  // Check if user has admin access to any tenant
  const tenantRoles = await TenantActions.getUserTenantRoles(session.user.id);
  console.log('🔍 Dashboard Layout - Tenant roles check:', {
    userId: session.user.id,
    tenantRoles: tenantRoles?.length || 0,
    roles: tenantRoles?.map(r => ({ tenantId: r.tenantId, role: r.role }))
  });
  
  const hasAdminAccess = tenantRoles?.some(role => 
    (role.role === 'admin' || role.role === 'owner')
  ) || false;

  console.log('🔍 Dashboard Layout - Admin access check:', { hasAdminAccess });

  if (!hasAdminAccess) {
    console.log('🔍 Dashboard Layout - No admin access, redirecting to unauthorized');
    redirect('/dashboard/unauthorized');
  }

  console.log('🔍 Dashboard Layout - Access granted, rendering dashboard');

  return (
    <UserProvider>
      <SidebarProvider defaultOpen={false}>
        <AppSidebar />
        {children}
      </SidebarProvider>
    </UserProvider>
  );
};

export default DashboardLayout;
