/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssistantSidebar } from '../src/components/assistant-sidebar';
import { SidebarProvider } from '../src/components/ui/sidebar';
import { AdminContextValue } from '../src/contexts/AdminContext';

// Mock next-auth useSession
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'test-user', is_anonymous: false } } }),
}));

// Mock AdminContext hook
jest.mock('../src/hooks/use-current-roles', () => ({
  useCurrentRoles: () => ({
    isTenantAdmin: true,
    isTenantOwner: true,
    isOrgAdmin: true,
    isOrgOwner: true,
    loading: false,
    refresh: () => {},
  }),
}));

jest.mock('../src/contexts/AdminContext', () => ({
  useAdminContext: () => ({
    selectedTenantId: 't1',
    setSelectedTenantId: () => {},
    selectedOrganizationId: undefined,
    setSelectedOrganizationId: () => {},
    refreshVersion: 0,
    triggerRefresh: () => {},
  } as AdminContextValue),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/assistants',
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
  }),
}));

beforeEach(() => {
  window.matchMedia = window.matchMedia || function() {
    return {
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      dispatchEvent: jest.fn(),
    };
  };
});

describe('AssistantSidebar', () => {
  const assistants: any[] = [
    { _id: '1', tenantId: 't1', name: 'Alpha', firstMessage: 'Hello' },
    { _id: '2', tenantId: 't1', name: 'Beta', firstMessage: 'Hi' },
  ];

  it('renders assistants and filters by search', () => {
    render(
      <SidebarProvider>
        <AssistantSidebar assistants={assistants} />
      </SidebarProvider>
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search assistants...'), { target: { value: 'Beta' } });
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });
}); 