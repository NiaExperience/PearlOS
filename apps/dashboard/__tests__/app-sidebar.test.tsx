/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { useSession as useSessionOriginal } from 'next-auth/react';

import { AppSidebar } from '../src/components/app-sidebar';
import { SidebarProvider } from '../src/components/ui/sidebar';

jest.mock('next-auth/react');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/dashboard/assistants',
}));

const useSession = useSessionOriginal as jest.Mock;

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

describe('AppSidebar', () => {
  it('renders navigation and user when authenticated', () => {
    useSession.mockReturnValue({ data: { user: { name: 'Test' } }, status: 'authenticated' });
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    );
    expect(screen.getByText('Assistants')).toBeInTheDocument();
  });

  it('redirects to login when unauthenticated', () => {
    const push = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue({ push });
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    );
    expect(push).toHaveBeenCalledWith('/login');
  });
}); 