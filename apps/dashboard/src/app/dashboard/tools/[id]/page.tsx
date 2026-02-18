import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';
import { redirect } from 'next/navigation';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const ToolDetailPage = async ({ params }: { params: { id: string } }) => {
  // Additional check for the tool detail page
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
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Tool Details</h1>
      <p className="text-muted-foreground">
        Tool ID: {params.id}
      </p>
      <p className="text-muted-foreground">
        This is a tool detail page. Tool-specific content will be implemented here.
      </p>
    </div>
  );
};

export default ToolDetailPage; 