'use client';

import { useSession, signOut } from 'next-auth/react';
import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dashboard/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@dashboard/components/ui/sidebar';
import { LogOut, ChevronsUpDown, Settings, Shield, Users } from 'lucide-react';
import { useAdminStatus } from '@dashboard/hooks/use-admin-status';
import { useToast } from '@dashboard/hooks/use-toast';
import { useRouter } from 'next/navigation';

export function NavUser() {
  const { isMobile } = useSidebar();
  const { data: session, status } = useSession();
  const { isAdmin, isLoading: adminLoading } = useAdminStatus();
  const { toast } = useToast();
  const router = useRouter();

  if (status === 'loading' || adminLoading || !session?.user) return null;
  const user = session.user;

  const handleSignOut = async () => {
    try {
      const response = await fetch('/api/auth/signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        // Also call NextAuth's signOut to clear client-side state
        await signOut();
        
        toast({
          title: "Signed out",
          description: "You have been successfully signed out.",
        });
        // Redirect to login page
        router.push('/login');
        // Force a page reload to clear any client-side state
        router.refresh();
      } else {
        throw new Error('Sign-out failed');
      }
    } catch (error) {
      console.error('Sign-out error:', error);
      toast({
        title: "Sign out error",
        description: "There was an error signing you out: " + error,
        variant: "destructive",
      });
    }
  };

  const handleUserSettings = () => {
    router.push('/dashboard/settings'); // now user sees profile/security when clicking user settings button (will rename below)
  };

  const handleAdminSettings = () => {
    router.push('/dashboard/admin');
  };

  const handleUserManagement = () => {
    router.push('/dashboard/users');
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              <Avatar className='h-8 w-8 rounded-lg'>
                {user.image ? (
                  <AvatarImage src={user.image} alt={user.name || ''} />
                ) : null}
                <AvatarFallback className='rounded-lg'>
                  {user.name?.charAt(0) || user.email?.charAt(0) || '?'}
                </AvatarFallback>
              </Avatar>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>{user.name}</span>
                <span className='truncate text-xs'>{user.email}</span>
                {isAdmin && (
                  <span className='truncate text-xs text-blue-500 font-medium'>Admin</span>
                )}
              </div>
              <ChevronsUpDown className='ml-auto size-4' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg'
            side={isMobile ? 'bottom' : 'right'}
            align='end'
            sideOffset={4}
          >
            <DropdownMenuLabel className='p-0 font-normal'>
              <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
                <Avatar className='h-8 w-8 rounded-lg'>
                  {user.image ? (
                    <AvatarImage src={user.image} alt={user.name || ''} />
                  ) : null}
                  <AvatarFallback className='rounded-lg'>
                    {user.name?.charAt(0) || user.email?.charAt(0) || '?'}
                  </AvatarFallback>
                </Avatar>
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-semibold'>{user.name}</span>
                  <span className='truncate text-xs'>{user.email}</span>
                  {isAdmin && (
                    <span className='truncate text-xs text-blue-500 font-medium'>Admin</span>
                  )}
                </div>
              </div>
            </DropdownMenuLabel>
            
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>
                    Admin Actions
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={handleUserSettings}>
                    <Shield className='mr-2 h-4 w-4' />
                    User Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleUserManagement} title="User Status" aria-label="User Status">
                    <Users className='mr-2 h-4 w-4' />
                    User Status
                  </DropdownMenuItem> 
                  <DropdownMenuItem onClick={handleAdminSettings}>
                    <Users className='mr-2 h-4 w-4' />
                    Admin Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
            
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>User</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleAdminSettings}>
                <Settings className='mr-2 h-4 w-4' />
                User Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className='mr-2 h-4 w-4' />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
