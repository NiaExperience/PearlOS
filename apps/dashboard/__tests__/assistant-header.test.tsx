/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssistantHeader } from '../src/components/assistant-header';

// Mock hooks & next/navigation similar to other dashboard component tests
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
  }),
}));

// Mock toast hook
jest.mock('../src/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

// Provide clipboard mock (used by copy URL button)
beforeAll(() => {
  // matchMedia polyfill (copied pattern from existing tests)
  window.matchMedia = window.matchMedia || function () {
    return {
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      dispatchEvent: jest.fn(),
    } as any;
  };
  (global as any).navigator.clipboard = {
    writeText: jest.fn().mockResolvedValue(undefined),
  };
});

const BASE_PROPS = { assistant: { _id: 'a1', name: 'Test Assistant', subDomain: 'test-assistant' } } as const;

// Helper to render after setting env vars
function renderWithEnv(env: Record<string, string | undefined>) {
  // Preserve originals
  const original: Record<string, string | undefined> = {};
  Object.keys(env).forEach(k => { original[k] = process.env[k]; });
  // Apply overrides (undefined deletes)
  Object.entries(env).forEach(([k, v]) => {
    if (v === undefined) delete (process.env as any)[k]; else process.env[k] = v;
  });
  render(<AssistantHeader {...BASE_PROPS} />);
  // Restore after test finishes
  return () => {
    Object.entries(original).forEach(([k, v]) => {
      if (v === undefined) delete (process.env as any)[k]; else process.env[k] = v;
    });
  };
}

describe('AssistantHeader base URL resolution', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses NEXT_PUBLIC_INTERFACE_BASE_URL when set', () => {
    const restore = renderWithEnv({
      NEXT_PUBLIC_INTERFACE_BASE_URL: 'https://interface.public.example.com',
      INTERFACE_BASE_URL: undefined,
      NEXT_PUBLIC_API_URL: 'https://dashboard.public.example.com',
    });
    const linkText = screen.getByText('https://interface.public.example.com/test-assistant');
    expect(linkText).toBeInTheDocument();
    restore();
  });

  it('falls back to server-only INTERFACE_BASE_URL when NEXT_PUBLIC_INTERFACE_BASE_URL is absent', () => {
    const restore = renderWithEnv({
      NEXT_PUBLIC_INTERFACE_BASE_URL: undefined,
      INTERFACE_BASE_URL: 'https://interface.server.example.com',
      NEXT_PUBLIC_API_URL: 'https://dashboard.server.example.com',
    });
    expect(screen.getByText('https://interface.server.example.com/test-assistant')).toBeInTheDocument();
    restore();
  });

  it('derives interface URL from NEXT_PUBLIC_API_URL when no interface vars provided', () => {
    const restore = renderWithEnv({
      NEXT_PUBLIC_INTERFACE_BASE_URL: undefined,
      INTERFACE_BASE_URL: undefined,
      NEXT_PUBLIC_API_URL: 'https://dashboard.other.com',
    });
    // Replace 'dashboard' with 'interface'
    expect(screen.getByText('https://interface.other.com/test-assistant')).toBeInTheDocument();
    restore();
  });

  it('uses hardcoded fallback when neither interface vars nor NEXT_PUBLIC_API_URL are set', () => {
    const restore = renderWithEnv({
      NEXT_PUBLIC_INTERFACE_BASE_URL: undefined,
      INTERFACE_BASE_URL: undefined,
      NEXT_PUBLIC_API_URL: undefined,
    });
    // Hardcoded fallback inside component
    expect(screen.getByText('https://interface.stg.nxops.net/test-assistant')).toBeInTheDocument();
    restore();
  });

  it('copies the correct URL to clipboard', async () => {
    const restore = renderWithEnv({
      NEXT_PUBLIC_INTERFACE_BASE_URL: 'https://interface.copy.example.com',
      INTERFACE_BASE_URL: undefined,
      NEXT_PUBLIC_API_URL: 'https://dashboard.copy.example.com',
    });
    const copyButton = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://interface.copy.example.com/test-assistant');
    restore();
  });

  it('renders a clickable Assistant ID badge and copies the ID to clipboard', () => {
    const restore = renderWithEnv({
      NEXT_PUBLIC_INTERFACE_BASE_URL: 'https://interface.example.com',
      INTERFACE_BASE_URL: undefined,
      NEXT_PUBLIC_API_URL: 'https://dashboard.example.com',
    });
    // Badge text should include the ID label
    const idBadge = screen.getByText(/ID:\s*a1/i);
    expect(idBadge).toBeInTheDocument();
    fireEvent.click(idBadge);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('a1');
    restore();
  });
});
