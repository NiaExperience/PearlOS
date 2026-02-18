"use client";
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface AdminContextValue {
  selectedTenantId?: string;
  setSelectedTenantId: (id?: string) => void;
  selectedOrganizationId?: string;
  setSelectedOrganizationId: (id?: string) => void;
  refreshVersion: number;
  triggerRefresh: () => void;
}

const AdminContext = createContext<AdminContextValue | undefined>(undefined);

export const AdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | undefined>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshVersion(v => v + 1), []);

  // If tenant selection changes, clear organization selection
  useEffect(() => {
    setSelectedOrganizationId(undefined);
  }, [selectedTenantId]);

  return (
    <AdminContext.Provider value={{ selectedTenantId, setSelectedTenantId, selectedOrganizationId, setSelectedOrganizationId, refreshVersion, triggerRefresh }}>
      {children}
    </AdminContext.Provider>
  );
};

export function useAdminContext() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdminContext must be used within AdminProvider');
  return ctx;
}
