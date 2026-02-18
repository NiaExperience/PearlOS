/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock router + search params for two scenarios. We'll override implementation per test.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: jest.fn(),
}));

// Mock next-auth/react defaults from global setup can be overridden as needed
jest.mock('next-auth/react', () => {
  const useSession = jest.fn(() => ({ data: null, status: 'unauthenticated' }));
  const signIn = jest.fn();
  const signOut = jest.fn();
  return { __esModule: true, useSession, signIn, signOut };
});

// Provide fetch mock
const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

// Import the component under test
import LoginForm from '../src/components/login-form';
import { useSearchParams } from 'next/navigation';

function setSearchParamsMock(map: Record<string, string | null>) {
  (useSearchParams as jest.Mock).mockReturnValue({
    get: (k: string) => map[k] ?? null,
  });
}

describe('LoginForm invite utilities visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
  });

  it('hides Resend Invite when no invite token in URL', () => {
    setSearchParamsMock({});
    render(<LoginForm />);
    expect(screen.queryByRole('button', { name: /Resend Invite/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Forgot Password\?/i })).toBeNull();
  });

  it('shows Resend Invite when token present and triggers API after entering email', async () => {
    setSearchParamsMock({ token: 'abc123' });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    render(<LoginForm />);

    // Buttons are visible
    expect(await screen.findByRole('button', { name: /Resend Invite/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Forgot Password\?/i })).toBeInTheDocument();

    // Enter email (required for resend invite handler)
    const emailInput = screen.getByLabelText(/Email/i);
    fireEvent.change(emailInput, { target: { value: 'john@example.com' } });

    // Click Resend Invite and expect API call
    fireEvent.click(screen.getByRole('button', { name: /Resend Invite/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/users/resend-invite', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }));
    });
  });
});
