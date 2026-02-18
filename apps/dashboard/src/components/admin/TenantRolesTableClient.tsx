/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React from 'react';

interface Tenant {
  _id: string;
  name: string;
  [k: string]: any;
}
interface Role {
  _id: string;
  tenantId: string;
  role: string;
  [k: string]: any;
}
interface Props {
  tenants: Tenant[];
  roles: Role[];
  isSuperAdmin: boolean; // kept for parity, unused in read-only
}

export default function TenantRolesTableClient({ tenants, roles }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-4">Tenant</th>
            <th className="py-2 pr-4">Role</th>
          </tr>
        </thead>
        <tbody>
          {roles.map(r => {
            const tenant = tenants.find(t => t._id === r.tenantId);
            return (
              <tr key={r._id} className="border-b last:border-b-0">
                <td className="py-2 pr-4 font-medium">{tenant?.name || r.tenantId}</td>
                <td className="py-2 pr-4 capitalize">{r.role}</td>
              </tr>
            );
          })}
          {roles.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-muted-foreground text-xs">No tenant roles.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
