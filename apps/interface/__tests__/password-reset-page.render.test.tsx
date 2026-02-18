/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Lightweight mock for next/navigation hooks
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'token' ? 'sample-token' : null) }),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() })
}));

// Mock fetch for submit
const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

// Dynamically import the page component (path relative to compiled test context)
// Import the Next.js page component directly
import { ResetPassword as ResetPasswordComponent } from '../src/components/auth/ResetPassword';

describe('ResetPassword component UI', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('renders form fields and submits', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  render(<ResetPasswordComponent />);
    const newPass = screen.getByLabelText(/New Password/i);
    const confirmPass = screen.getByLabelText(/Confirm Password/i);
    fireEvent.change(newPass, { target: { value: 'MyNewPass123!' } });
    fireEvent.change(confirmPass, { target: { value: 'MyNewPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Password/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('shows error on failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Invalid or expired token' }) });
  render(<ResetPasswordComponent />);
    const newPass = screen.getByLabelText(/New Password/i);
    const confirmPass = screen.getByLabelText(/Confirm Password/i);
    fireEvent.change(newPass, { target: { value: 'MyNewPass123!' } });
    fireEvent.change(confirmPass, { target: { value: 'MyNewPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Password/i }));
    await waitFor(() => screen.getByText(/Invalid or expired token/i));
  });
});
