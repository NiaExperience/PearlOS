'use client';

import * as React from 'react';
import Image from 'next/image';
import {
  Bot,
  Settings,
  Users,
  ShieldAlert,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

import { NavMain } from '@dashboard/components/nav-main';
import { NavUser } from '@dashboard/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  useSidebar,
} from '@dashboard/components/ui/sidebar';
import { cn } from '@dashboard/lib/utils';

// This is sample data.
const data = {
  user: {
    name: 'Nia',
    email: 'nia@niaxp.com',
    avatar: '/avatars/shadcn.jpg',
  },
  navMain: [
    {
      title: 'Assistants',
      url: '/dashboard/assistants',
      icon: Bot,
      isAdmin: false,
    },
    {
      title: 'Admin Panel',
      url: '/dashboard/admin',
      icon: ShieldAlert,
      isAdmin: true,
    },
    {
      title: 'User Settings',
      url: '/dashboard/settings',
      icon: Settings,
      isAdmin: false,
    },
    {
      title: 'Users Status',
      url: '/dashboard/users',
      icon: Users,
      isAdmin: true,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { open } = useSidebar();
  
  // Must match server DISABLE_DASHBOARD_AUTH (set NEXT_PUBLIC_DISABLE_DASHBOARD_AUTH in dashboard env).
  const isDashboardAuthDisabled =
    process.env.NEXT_PUBLIC_DISABLE_DASHBOARD_AUTH === 'true';

  // Redirect to login if unauthenticated
  React.useEffect(() => {
    if (status === 'unauthenticated' && !isDashboardAuthDisabled) {
      router.push('/dashboard/login');
    }
  }, [status, router, isDashboardAuthDisabled]);

  return (
    <Sidebar collapsible='icon' {...props} className='z-50'>
      <div
        className={cn(
          'flex items-center gap-2 p-4 h-[69px]',
          open ? 'justify-start' : 'justify-center'
        )}
      >
      </div>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        {status === 'authenticated' && session?.user ? (
          <NavUser />
        ) : isDashboardAuthDisabled ? (
          <div className='flex items-center justify-center p-4 text-xs text-muted-foreground'>
            Dashboard auth disabled (env)
          </div>
        ) : (
          <div className='flex items-center justify-center p-4'>
            <div className='animate-spin size-3 border-2 border-primary border-t-transparent rounded-full' />
          </div>
        )}
      </SidebarFooter>
      {/* <SidebarRail /> */}   {/* turned off for now because it's not working */}
    </Sidebar>
  );
}
