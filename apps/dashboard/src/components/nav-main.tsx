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
  
  const isDashboardAuthDisabled =
    process.env.NEXT_PUBLIC_DISABLE_DASHBOARD_AUTH === 'true';

  // Don't render admin items while loading admin status
  if (adminLoading) {
    return null;
  }

  // Show admin items if user is admin OR dashboard auth is explicitly disabled
  const canShowAdminItems = isAdmin || isDashboardAuthDisabled;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          !item.isAdmin || ((session?.user || isDashboardAuthDisabled) && canShowAdminItems) ? (
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
