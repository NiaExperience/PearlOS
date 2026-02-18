import { AssistantActions, TenantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import React from 'react';

import { AssistantHeader } from '@dashboard/components/assistant-header';
import { AssistantTabs } from '@dashboard/components/assistant-tabs';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const AssistantDetailPage = async ({ params }: { params: { id: string } }) => {
  // Check if dashboard auth is disabled for local development
  const headersList = await headers();
  const host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const disableAuth =
     process.env.DISABLE_DASHBOARD_AUTH === 'true' ||
    (process.env.NODE_ENV === 'development' &&
      (host.includes('localhost') ||
        host.includes('127.0.0.1') ||
        host.includes('runpod.net') ||
        process.env.NEXTAUTH_URL?.includes('localhost')));

  const session = disableAuth ? null : await getSessionSafely(undefined, dashboardAuthOptions);
  
  // Only enforce auth checks when auth is enabled
  if (!disableAuth) {
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
  }

  const { id: idParam } = await params;
    // Empty or missing id (e.g. link was /dashboard/assistants/) → show list
  if (!idParam || typeof idParam !== 'string' || idParam.trim() === '') {
    redirect('/dashboard/assistants');
  }

  // Reserved slug: if someone navigates to /dashboard/assistants/users (likely intending the admin panel)
  if (idParam === 'users') {
    redirect('/dashboard/users');
  }

  // Skip tenant checks in local dev mode
  if (!disableAuth && session?.user) {
  const tenants = await TenantActions.getTenantsForUser(session.user.id);
  if (!tenants || tenants.length === 0) {
    throw new Error('No tenants found');
  }
  // TODO: FIX. THIS IS A BUG.
  // We need a tenant chooser for the dashboard.
  // For now, just use the first tenant
  const tenantId = tenants[0]._id;
  if (!await TenantActions.userHasAccess(session.user.id, tenantId!)) {
    throw new Error('Unauthorized');
    }
  }

  let assistant = await AssistantActions.getAssistantById(idParam);
  if (!assistant) {
    // Fallback: treat param as subDomain slug
    assistant = await AssistantActions.getAssistantBySubDomain(idParam);
  }

  if (!assistant) {
    return <div>Assistant not found</div>;
  }

  // Migrate allowedPersonalities from UUID keys to composite keys
  if (assistant.allowedPersonalities && typeof assistant.allowedPersonalities === 'object' && !Array.isArray(assistant.allowedPersonalities)) {
    const allowedPersonalities = assistant.allowedPersonalities as Record<string, {
      personalityId?: string;
      name?: string;
      voiceId?: string;
      voiceProvider?: string;
      voiceParameters?: unknown;
    }>;
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const migrated: Record<string, unknown> = {};
    let needsMigration = false;
    
    for (const [key, config] of Object.entries(allowedPersonalities)) {
      if (uuidRegex.test(key)) {
        // Old UUID format - migrate to composite key
        const name = config.name || 'unnamed';
        const provider = config.voiceProvider || 'unknown';
        const voiceId = config.voiceId || 'no-voice';
        const newKey = `${name}-${provider}-${voiceId}`;
        migrated[newKey] = config;
        needsMigration = true;
      } else {
        // Already using composite key format
        migrated[key] = config;
      }
    }
    
    // If migration happened, immediately save back to database
    if (needsMigration) {
      await AssistantActions.updateAssistant(assistant._id!, { allowedPersonalities: migrated });
      // Update the local assistant object with migrated data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (assistant as any).allowedPersonalities = migrated;
    }
  }

  // Convert createdAt to string if it is a Date
  const safeAssistant = {
    ...assistant,
    createdAt: assistant.createdAt instanceof Date ? assistant.createdAt.toISOString() : assistant.createdAt,
  };

  return (
    <div className='w-full'>
      <AssistantHeader assistant={safeAssistant} />
      <AssistantTabs assistant={safeAssistant} />
    </div>
  );
};

export default AssistantDetailPage;
