import React from 'react';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { AssistantActions } from '@nia/prism/core/actions';
import { Bot, PlusCircle } from 'lucide-react';
import { ThemeToggle } from '@dashboard/components/theme-toggle';
import { Button } from '@dashboard/components/ui/button';
import { DialogTrigger } from '@dashboard/components/ui/dialog';
import { Dialog } from '@dashboard/components/ui/dialog';
import CreateAssistantModal from '@dashboard/components/create-assistant-modal';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Prism } from '@nia/prism';
import { BlockType_Assistant } from '@nia/prism/core/blocks/assistant.block';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const AssistantsPage = async () => {
  const headersList = await headers();
  const host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const disableAuth =
    process.env.DISABLE_DASHBOARD_AUTH === 'true' ||
    (process.env.NODE_ENV === 'development' &&
      (host.includes('localhost') ||
        host.includes('127.0.0.1') ||
        host.includes('runpod.net') ||
        process.env.NEXTAUTH_URL?.includes('localhost')));

  // Additional check for the assistants page
  const session = disableAuth ? null : await getSessionSafely(undefined, dashboardAuthOptions);
  const userId = disableAuth ? 'local-dev-admin' : session?.user?.id;

  if (!userId) {
    redirect('/login');
  }

  // Deny access to anonymous users
  if (!disableAuth && session?.user?.is_anonymous) {
    redirect('/login');
  }

  // Check if user has admin access to any tenant
  const tenantRoles = disableAuth ? [{ role: 'owner' }] : await TenantActions.getUserTenantRoles(userId);
  const hasAdminAccess = tenantRoles?.some((role: any) => (role.role === 'admin' || role.role === 'owner')) || false;

  if (!hasAdminAccess) {
    redirect('/login');
  }

  // Get assistants from ALL tenants the user has access to
  let assistants: any[] = [];
  if (disableAuth) {
    // In local dev, query all assistants directly without user filtering
    try {
      const prism = await Prism.getInstance();
      const result = await prism.query({
        contentType: BlockType_Assistant,
        tenantId: 'any',
        limit: 500,
        orderBy: { createdAt: 'desc' }
      });
      if (result && result.items) {
        // Map the raw items to IAssistant format
        assistants = result.items.map((item: any) => {
          const content = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
          const indexer = typeof item.indexer === 'string' ? JSON.parse(item.indexer) : item.indexer;
          return {
            _id: item.page_id,
            name: content?.name || indexer?.name,
            subDomain: content?.subDomain || indexer?.subDomain,
            tenantId: item.parent_id || content?.tenantId,
            firstMessage: content?.firstMessage,
            ...content
          };
        });
      }
    } catch (error) {
      console.error('[assistants] Failed to load assistants in local dev mode:', error);
      assistants = [];
    }
  } else {
    assistants = await AssistantActions.getAllAssistantsForUser(userId) || [];
  }

  if (!assistants?.length) {
    return (
      <div className='w-full'>
        <header className='flex h-16 items-center gap-2 justify-between mr-4'>
          <div className='flex items-center gap-2 px-4'>
            <h1>Assistants</h1>
          </div>
          <ThemeToggle />
        </header>
        <div className='flex flex-1 flex-col gap-4 p-4 pt-0 justify-center items-center h-[calc(100vh-64px)]'>
          <div className='flex flex-col gap-4 justify-center items-center'>
            <Bot className='size-12 text-muted-foreground' />
            <h1 className='text-2xl font-bold'>Assistants</h1>
            <p className='text-center text-sm max-w-sm'>
              Assistants are voice AI chat bots used for integrations into your
              applications.
            </p>
            <p className='text-center text-sm max-w-sm'>
              You can fully configure them to your business&apos;s needs, and
              we support all major models and providers.
            </p>
            <Dialog>
              <DialogTrigger className='w-full'>
                <Button className='w-full' asChild>
                  <div className='flex items-center gap-2 w-full'>
                    Create Assistant <PlusCircle className='size-4' />
                  </div>
                </Button>
              </DialogTrigger>
              <CreateAssistantModal />
            </Dialog>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='w-full'>
      <header className='flex h-16 items-center gap-2 justify-between mr-4'>
        <div className='flex items-center gap-2 px-4'>
          <h1>Assistants</h1>
        </div>
        <ThemeToggle />
      </header>
      <div className='flex flex-1 flex-col gap-4 p-4 pt-0 justify-center items-center h-[calc(100vh-64px)]'>
        <div className='flex flex-col gap-4 justify-center items-center'>
          <Bot className='size-12 text-muted-foreground' />
          <h1 className='text-2xl font-bold'>Assistants</h1>
          <p className='text-center text-sm max-w-sm'>
            Select any assistants from the left sidebar to see its properties
          </p>
        </div>
      </div>
    </div>
  );
};

export default AssistantsPage;
