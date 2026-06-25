/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';

import FilesView from '../src/features/Files/components/FilesView';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

jest.mock('@interface/hooks/use-interface-customization', () => ({
  useInterfaceCustomization: () => ({
    theme: 'pixel',
    backgrounds: {},
    icons: {},
    customThemes: [],
    updatedAt: 0,
  }),
}));

jest.mock('@interface/features/ManeuverableWindow/lib/windowLifecycleController', () => ({
  requestWindowOpen: jest.fn(),
}));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockRequestWindowOpen = requestWindowOpen as jest.MockedFunction<typeof requestWindowOpen>;

describe('FilesView', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
      status: 'authenticated',
    } as any);
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.startsWith('/api/files/search')) {
        return {
          ok: true,
          json: async () => ({
            query: 'arcade PNGs',
            openedPath: 'arcade-game/assets',
            message: 'I found assets for "arcade PNGs" and opened the closest folder.',
            best: {
              name: 'assets',
              kind: 'folder',
              path: 'arcade-game/assets',
              parentPath: 'arcade-game',
              score: 40,
              matchReason: '2 matching files inside',
            },
            results: [],
          }),
        } as Response;
      }
      if (value === '/api/shared-with-me') {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                resourceId: 'note-1',
                resourceType: 'Notes',
                title: 'Shared Note',
                role: 'viewer',
                ownerName: 'Blair',
                href: '/notes?noteId=note-1',
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          relativePath: value.includes('arcade-game%2Fassets') ? 'arcade-game/assets' : '',
          entries: value.includes('arcade-game%2Fassets')
            ? [{ name: 'hero.png', kind: 'file', path: 'arcade-game/assets/hero.png', parentPath: 'arcade-game/assets', ext: 'png' }]
            : [
                { name: 'arcade-game', kind: 'folder', path: 'arcade-game', parentPath: '' },
                { name: 'report.pdf', kind: 'file', path: 'Documents/report.pdf', parentPath: 'Documents', ext: 'pdf' },
              ],
        }),
      } as Response;
    }) as jest.Mock;
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renders the native FileSpace shell and directory entries', async () => {
    render(<FilesView />);

    expect(await screen.findByText('FileSpace')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('arcade-game').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTitle('FileSpace')).not.toBeInTheDocument();
  });

  it('runs an incoming Pearl file search and opens the returned folder', async () => {
    await act(async () => {
      render(<FilesView initialSearchQuery="arcade PNGs" initialSearchNonce={1} />);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/files/search?q=arcade%20PNGs');
    });
    expect(await screen.findByText('hero.png')).toBeInTheDocument();
    expect(screen.getByText(/opened the closest folder/i)).toBeInTheDocument();
  });

  it('submits typed natural language search from the toolbar', async () => {
    render(<FilesView />);

    fireEvent.change(await screen.findByPlaceholderText('Ask Pearl to find files'), {
      target: { value: 'arcade PNGs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/files/search?q=arcade%20PNGs');
    });
  });

  it('integrates Shared with Me into FileSpace', async () => {
    render(<FilesView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Shared with Me' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/shared-with-me');
    });
    expect(await screen.findByText('Shared Note')).toBeInTheDocument();
    expect(screen.getByText(/Note · viewer · Blair/i)).toBeInTheDocument();
  });

  it('opens PDFs directly instead of wrapping them in an applet preview', async () => {
    const popup = {
      opener: window,
      location: { href: '' },
    };
    (window.open as jest.Mock).mockReturnValue(popup);
    render(<FilesView />);

    fireEvent.click(await screen.findByRole('button', { name: /report\.pdf/i }));

    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe('/api/files/content?path=Documents%2Freport.pdf');
    expect(mockRequestWindowOpen).not.toHaveBeenCalledWith(expect.objectContaining({ viewType: 'htmlContent' }));
  });

  it('shows guidance when the browser blocks a PDF viewer popup', async () => {
    (window.open as jest.Mock).mockReturnValue(null);
    render(<FilesView />);

    fireEvent.click(await screen.findByRole('button', { name: /report\.pdf/i }));

    expect(await screen.findByText(/Chrome blocked the PDF viewer/i)).toBeInTheDocument();
    expect(mockRequestWindowOpen).not.toHaveBeenCalledWith(expect.objectContaining({ viewType: 'htmlContent' }));
  });
});
