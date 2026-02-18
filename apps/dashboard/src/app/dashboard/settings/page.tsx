import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { Settings, User, KeyRound } from 'lucide-react';
import { getSessionSafely } from '@nia/prism/core/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function UserSettingsHub() {
  // Allow access if DISABLE_DASHBOARD_AUTH is true for local development
  const isLocalDevBypass = process.env.DISABLE_DASHBOARD_AUTH === 'true';
  
  if (!isLocalDevBypass) {
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  if (!session?.user || session.user.is_anonymous) redirect('/login');
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6" />
        <h1 className="text-2xl font-bold">User Settings</h1>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2"><User className="h-4 w-4" /><h2 className="font-semibold">Profile</h2></div>
          <p className="text-sm text-muted-foreground">View or update your profile information.</p>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2"><KeyRound className="h-4 w-4" /><h2 className="font-semibold">Security</h2></div>
          <p className="text-sm text-muted-foreground">Change password & manage authentication options.</p>
        </div>
      </div>
    </div>
  );
}