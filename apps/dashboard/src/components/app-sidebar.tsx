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
  
  // Use useState + useEffect to avoid hydration mismatch
  // Start with false so server and client initial render match
  const [isLocalNoAuth, setIsLocalNoAuth] = React.useState(false);

  React.useEffect(() => {
    // Only check on client side to avoid hydration mismatch
    // Check hostname and NODE_ENV (both available on client)
    const checkLocalNoAuth = 
      process.env.NODE_ENV === 'development' &&
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.includes('runpod.net'));
    setIsLocalNoAuth(checkLocalNoAuth);
  }, []);

  // Redirect to login if unauthenticated
  React.useEffect(() => {
    if (status === 'unauthenticated' && !isLocalNoAuth) {
      router.push('/login');
    }
  }, [status, router, isLocalNoAuth]);

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
        ) : isLocalNoAuth ? (
          <div className='flex items-center justify-center p-4 text-xs text-muted-foreground'>
            Local mode (auth disabled)
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
