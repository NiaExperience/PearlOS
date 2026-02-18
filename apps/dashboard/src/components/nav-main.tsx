'use client';

import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';

import { Collapsible } from '@dashboard/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@dashboard/components/ui/sidebar';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@dashboard/lib/utils';
import { useAdminStatus } from '@dashboard/hooks/use-admin-status';

export function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: LucideIcon;
    isActive?: boolean;
    isAdmin?: boolean;
    items?: {
      title: string;
      url: string;
    }[];
  }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const { data: session } = useSession();
  const { isAdmin, isLoading: adminLoading } = useAdminStatus();
  
  // Check if we're in local dev mode without auth
  const [isLocalNoAuth, setIsLocalNoAuth] = React.useState(false);
  React.useEffect(() => {
    const checkLocalNoAuth = 
      process.env.NODE_ENV === 'development' &&
      typeof window !== 'undefined' &&
           (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.includes('runpod.net'));
    setIsLocalNoAuth(checkLocalNoAuth);
  }, []);

  // Don't render admin items while loading admin status
  if (adminLoading) {
    return null;
  }

  // Show admin items if user is admin OR if in local dev mode
  const canShowAdminItems = isAdmin || isLocalNoAuth;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          !item.isAdmin || ((session?.user || isLocalNoAuth) && canShowAdminItems) ? (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={item.isActive}
              className='group/collapsible'
            >
              <SidebarMenuItem
                className={cn(
                  'border border-transparent',
                  item.url === path &&
                    'bg-muted border border-acccent rounded-md'
                )}
              >
                <SidebarMenuButton
                  tooltip={item.title}
                  onClick={() => router.push(item.url)}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </Collapsible>
          ) : null
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
