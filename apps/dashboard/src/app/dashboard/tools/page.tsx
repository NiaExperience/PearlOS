import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { ToolsActions } from '@nia/prism/core/actions';
import CreateToolsModal from '../../../components/create-tools-modal';
import { ThemeToggle } from '../../../components/theme-toggle';
import ToolsComponent from '../../../components/tools-page';
import { Button } from '../../../components/ui/button';
import { DialogTrigger } from '../../../components/ui/dialog';
import { Dialog } from '../../../components/ui/dialog';
import { PencilRuler, PlusCircle, Ruler } from 'lucide-react';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';
import { redirect } from 'next/navigation';
import React from 'react';

// Force dynamic rendering to prevent static generation errors
export const dynamic = 'force-dynamic';

const Tools = async () => {
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

  const tools = await ToolsActions.getAllTools(session.user.id);

  if (!tools?.length) {
    return (
      <div className='w-full'>
        <header className='flex h-16 items-center gap-2 justify-between mr-4'>
          <div className='flex items-center gap-2 px-4'>
            <h1>Tools</h1>
          </div>
          <ThemeToggle />
        </header>
        <div className='flex flex-1 flex-col gap-4 p-4 pt-0 justify-center items-center h-[calc(100vh-64px)]'>
          <div className='flex flex-col gap-4 justify-center items-center'>
            <PencilRuler className='size-12 text-muted-foreground' />
            <h1 className='text-2xl font-bold'>Tools</h1>
            <p className='text-center text-sm max-w-sm'>
              Tools are functions you make that can be utilized by your
              assistants in calls. You can create custom tools for assistants to
              use.
            </p>
            <Dialog>
              <DialogTrigger className='w-full'>
                <Button className='w-full' asChild>
                  <div className='flex items-center gap-2 w-full'>
                    Create Tool <PlusCircle className='size-4' />
                  </div>
                </Button>
              </DialogTrigger>
              <CreateToolsModal />
            </Dialog>
          </div>
        </div>
      </div>
    );
  }

  return <ToolsComponent tools={tools} />;
};

export default Tools;
