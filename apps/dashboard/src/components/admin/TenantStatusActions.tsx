/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { Trash2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { useToast } from '@dashboard/hooks/use-toast';

interface TenantStatusActionsProps {
  tenantId: string;
  isSuperAdmin?: boolean;
  onOptimisticUpdate?: (u: { action: 'delete'; tenantId: string; phase: 'apply' | 'revert' | 'commit' }) => void;
}

export const TenantStatusActions: React.FC<TenantStatusActionsProps> = ({ tenantId, isSuperAdmin, onOptimisticUpdate }) => {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function mutate(action: 'delete') {
    if (pending) return;
    if (action === 'delete') {
      const ok = window.confirm('PERMANENTLY delete this tenant? This cannot be undone.');
      if (!ok) return;
    }
    setPending(true);
    try {
      // Optimistic apply
      onOptimisticUpdate?.({ action, tenantId, phase: 'apply' });
      const res = await fetch(`/api/tenants/${tenantId}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to ${action} tenant`);
      }
      // Commit phase
      onOptimisticUpdate?.({ action, tenantId, phase: 'commit' });
      toast({
        title: 'Tenant deleted',
        description: data.tenant?.name || tenantId,
      });
      // Refresh server component data
      router.refresh();
    } catch (e: any) {
      // Revert on failure
      onOptimisticUpdate?.({ action, tenantId, phase: 'revert' });
      toast({
        title: 'Error',
        description: e.message || 'Unexpected error',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {isSuperAdmin && (
        <button
          type="button"
          onClick={() => mutate('delete')}
          disabled={pending}
          className="inline-flex items-center gap-1 text-red-800 hover:underline disabled:opacity-50"
          aria-label="Delete tenant permanently"
        >
          <Trash2 className="h-3 w-3" />{pending ? 'Deleting…' : 'Delete'}
        </button>
      )}
    </div>
  );
};

export default TenantStatusActions;
