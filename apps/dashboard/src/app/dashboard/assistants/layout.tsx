import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { getSessionSafely } from '@nia/prism/core/auth';
import { AssistantSidebar } from '../../../components/assistant-sidebar';
import { AdminProvider } from '../../../contexts/AdminContext';
import { TenantActions } from '@nia/prism/core/actions';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { SidebarProvider } from '../../../components/ui/sidebar';
import { AssistantActions } from '@nia/prism/core/actions';
import { headers } from 'next/headers';
import { Prism } from '@nia/prism';
import { BlockType_Assistant } from '@nia/prism/core/blocks/assistant.block';
import { BlockType_Tenant } from '@nia/prism/core/blocks/tenant.block';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

export default async function AssistantsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
  const userId = disableAuth ? null : session?.user?.id;
  if (!disableAuth && !userId) {
    return <div>Unauthorized</div>;
  }
  
  // Get tenants first so we can pass them to the sidebar
  let initialTenants: Array<{_id: string; name: string}> = [];
  const prism = await Prism.getInstance();
  try {
    const tenantsResult = await prism.query({
      contentType: BlockType_Tenant,
      tenantId: 'any',
      limit: 500
    });
    if (tenantsResult?.items) {
      initialTenants = tenantsResult.items.map((t: any) => ({
        _id: t._id,
        name: t.name || 'Unknown Tenant'
      }));
    }
  } catch (error) {
    console.error('[assistants layout] Failed to load tenants:', error);
  }
  
  // Get assistants - in local dev mode, get all assistants; otherwise get user's assistants
  let assistants: any[] = [];
  if (disableAuth) {
    // In local dev, query all assistants directly without user filtering
    try {
      const result = await prism.query({
        contentType: BlockType_Assistant,
        tenantId: 'any',
        limit: 500,
        orderBy: { createdAt: 'desc' }
      });
      if (result && result.items) {
        // Prism.query returns items as already-flattened content objects
        // The _id is already set from page_id by applyBusinessLogic
        assistants = result.items.map((item: any) => ({
          ...item,
          // Ensure _id is set (Prism already does this but be explicit)
         _id: item._id ?? item.page_id,
          name: item.name,
          subDomain: item.subDomain,
          tenantId: item.tenantId,
          firstMessage: item.firstMessage,
        }));
      }
    } catch (error) {
      console.error('[assistants] Failed to load assistants in local dev mode:', error);
      assistants = [];
    }
  } else {
    assistants = await AssistantActions.getAllAssistantsForUser(userId!) || [];
  }
  
  if (assistants) {
    assistants.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  const tenantRoles = disableAuth ? [{ role: TenantRole.OWNER }] : await TenantActions.getUserTenantRoles(userId!);
  const hasAdminAccess = tenantRoles?.some((r:any)=> (r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER)) || false;

  return (
    <AdminProvider>
      <SidebarProvider defaultOpen={false}>
        <AssistantSidebar 
          assistants={assistants ?? []} 
          canManageTenants={hasAdminAccess}
          initialTenants={initialTenants}
        />
        {children}
      </SidebarProvider>
    </AdminProvider>
  );
}
