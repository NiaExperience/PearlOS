import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';
import { redirect } from 'next/navigation';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const AccountSettingsPage = async () => {
  // Additional check for the account settings page
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
      <h1 className="text-2xl font-bold mb-6">Account Settings</h1>
      <div className="grid gap-6">
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-2">Profile Information</h2>
          <p className="text-muted-foreground">
            Update your personal information and account details.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-2">Security Settings</h2>
          <p className="text-muted-foreground">
            Manage your password and security preferences.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-2">Notification Preferences</h2>
          <p className="text-muted-foreground">
            Configure how you receive notifications and updates.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AccountSettingsPage;
