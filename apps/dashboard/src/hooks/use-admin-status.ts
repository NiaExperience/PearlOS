'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';

interface AdminStatus {
  isAdmin: boolean;
  adminTenants: string[];
  isLoading: boolean;
}

export function useAdminStatus(): AdminStatus {
  const { data: session } = useSession();
  const [adminStatus, setAdminStatus] = useState<AdminStatus>({
    isAdmin: false,
    adminTenants: [],
    isLoading: true,
  });

  useEffect(() => {
    async function checkAdminStatus() {
      const isLocalNoAuth =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.hostname.includes('runpod.net')) &&
        process.env.NODE_ENV !== 'production';

      if (isLocalNoAuth) {
        setAdminStatus({
          isAdmin: true,
          adminTenants: ['local-dev'],
          isLoading: false,
        });
        return;
      }

      if (!session?.user?.id) {
        setAdminStatus({
          isAdmin: false,
          adminTenants: [],
          isLoading: false,
        });
        return;
      }

      try {
        // Fetch user's tenant roles to check admin status
        const response = await fetch('/api/users/me/tenant-roles');
        if (response.ok) {
          const data = await response.json();
          const adminTenants = data.roles
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.filter((role: any) => 
              (role.role === 'admin' || role.role === 'owner')
            )
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((role: any) => role.tenantId) || [];
          
          setAdminStatus({
            isAdmin: adminTenants.length > 0,
            adminTenants,
            isLoading: false,
          });
        } else {
          setAdminStatus({
            isAdmin: false,
            adminTenants: [],
            isLoading: false,
          });
        }
      } catch (error) {
        console.error('Error checking admin status:', error);
        setAdminStatus({
          isAdmin: false,
          adminTenants: [],
          isLoading: false,
        });
      }
    }

    checkAdminStatus();
  }, [session?.user?.id]);

  return adminStatus;
} 