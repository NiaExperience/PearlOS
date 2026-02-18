import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { RegisterForm } from '../../components/register-form';
import { ThemeToggle } from '../../components/theme-toggle';
import DotPattern from '../../components/ui/dot-pattern';
import { cn } from '../../lib/utils';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';
import { redirect } from 'next/navigation';
import React from 'react';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const SecretPage = async () => {
  // Check authentication and admin access
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
    <div className='flex h-screen w-full items-center justify-center px-4'>
      <RegisterForm />
      <div className='fixed top-10 right-10 z-50'>
        <ThemeToggle />
      </div>

      <div className='w-full h-full fixed'>
        <DotPattern
          className={cn(
            '[mask-image:radial-gradient(900px_circle_at_center,white,transparent)]'
          )}
        />
      </div>
    </div>
  );
};

export default SecretPage;
