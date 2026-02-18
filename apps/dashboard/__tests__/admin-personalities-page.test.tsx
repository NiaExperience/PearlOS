/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import PersonalitiesAdminPage from '../src/app/dashboard/admin/personalities/personalities_client';

jest.mock('@nia/events', () => ({ EventIds: ['ROOM_JOINED'] }));

const mockToast = jest.fn();
jest.mock('../src/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast, toasts: [] }) }));
jest.mock('@dashboard/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast, toasts: [] }),
}));

describe('PersonalitiesAdminPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/tenants')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: 't1', name: 'Tenant One' }] }),
        } as any;
      }
      if (url.endsWith('/api/personalities')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                _id: 'p1',
                name: 'Alpha',
                tenantId: 't1',
                primaryPrompt: 'You are a helpful assistant.',
              },
            ],
          }),
        } as any;
      }
      if (url.includes('/api/assistants?tenantId=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ assistants: [{ _id: 'a1', tenantId: 't1', personalityId: 'p1' }] }),
        } as any;
      }
      if (url.includes('/api/personalities/p1?tenantId=')) {
        return { ok: true, status: 200, json: async () => ({ item: { _id: 'p1' } }) } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }) as any;
  });

  it('renders list with usage count and allows editing primary prompt', async () => {
    render(<PersonalitiesAdminPage />);
    // Name is rendered inside an input field
    await waitFor(() => expect(screen.getByDisplayValue('Alpha')).toBeInTheDocument());
    // Usage column shows 1
    const usedCell = screen.getByText('1');
    expect(usedCell).toBeInTheDocument();
    // Click the row via the Used cell to open the details panel
    fireEvent.click(usedCell);
    await waitFor(() => expect(screen.getByText('Primary Prompt')).toBeInTheDocument());
  });
});
