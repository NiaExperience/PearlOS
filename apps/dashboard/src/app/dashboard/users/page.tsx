import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { Users, RefreshCcw } from 'lucide-react';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';
import { redirect } from 'next/navigation';
import AdminPanel from './admin-panel';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const UsersPage = async () => {
  // Additional check for the users page
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
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6" />
        <h1 className="text-2xl font-bold">User Status</h1>
        <form action="/dashboard/users" method="get">
          <button type="submit" title="Refresh" aria-label="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded border text-muted-foreground hover:text-foreground hover:bg-accent">
            <RefreshCcw className="h-4 w-4" />
          </button>
        </form>
      </div>
      <AdminPanel />
    </div>
  );
};

export default UsersPage;
