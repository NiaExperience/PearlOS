/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';

// Mock Next.js hooks before any imports
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({
    data: { user: { id: '00000000-0000-0000-0000-000000000000', email: 'admin@niaxp.com' } },
    status: 'authenticated',
    update: jest.fn(),
  })),
}));

// Create stable mock functions to prevent re-render loops
const mockGet = jest.fn((key: string) => {
  const params: Record<string, string> = {
    error: 'test_error',
    scopes: 'gmail.readonly,drive.readonly',
  };
  return params[key] || null;
});

const mockHas = jest.fn((key: string) => key === 'scopes');
const mockToString = jest.fn(() => 'error=test_error&scopes=gmail.readonly,drive.readonly');

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockForward = jest.fn();
const mockRefresh = jest.fn();
const mockReplace = jest.fn();
const mockPrefetch = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(() => ({
    get: mockGet,
    has: mockHas,
    toString: mockToString,
  })),
  useRouter: jest.fn(() => ({
    push: mockPush,
    back: mockBack,
    forward: mockForward,
    refresh: mockRefresh,
    replace: mockReplace,
    prefetch: mockPrefetch,
  })),
}));

// Mock the incremental auth hook
jest.mock('../src/core/hooks/useIncrementalAuth.ts', () => ({
  useIncrementalAuth: jest.fn(() => ({
    // Return a plain object synchronously so awaited calls resolve immediately with minimal microtask churn
    checkScopes: jest.fn(() => ({ hasScopes: true, missingScopes: [] })),
    requestScopes: jest.fn(),
    loading: false,
  })),
}));

// Mock the incremental auth components
// Avoid JSX inside jest.mock factories (causes out-of-scope jsx_runtime vars after transpile)
jest.mock('../src/core/components/incremental-auth-components.tsx', () => {
  const ReactLocal = require('react');
  return {
    GmailPermissionCard: ({ children }: { children?: React.ReactNode }) =>
      ReactLocal.createElement('div', { 'data-testid': 'gmail-permission-card' }, children),
    DrivePermissionCard: ({ children }: { children?: React.ReactNode }) =>
      ReactLocal.createElement('div', { 'data-testid': 'drive-permission-card' }, children),
    CalendarPermissionCard: ({ children }: { children?: React.ReactNode }) =>
      ReactLocal.createElement('div', { 'data-testid': 'calendar-permission-card' }, children),
  };
});

// Mock Lucide React icons
jest.mock('lucide-react', () => {
  const ReactLocal = require('react');
  const el = (testId: string) => () => ReactLocal.createElement('div', { 'data-testid': testId });
  return {
    Mail: el('mail-icon'),
    FileText: el('file-text-icon'),
    Calendar: el('calendar-icon'),
    Shield: el('shield-icon'),
    Info: el('info-icon'),
    AlertTriangle: el('alert-triangle-icon'),
    ArrowLeft: el('arrow-left-icon'),
    RefreshCw: el('refresh-icon'),
    CheckCircle: el('check-circle-icon'),
  };
});

// Mock browser APIs with stable references
const mockPostMessage = jest.fn();
const mockLocalStorageSetItem = jest.fn();
const mockLocalStorageGetItem = jest.fn();
const mockLocalStorageRemoveItem = jest.fn();
const mockLocalStorageClear = jest.fn();

Object.defineProperty(window, 'opener', {
  writable: true,
  value: {
    postMessage: mockPostMessage,
    closed: false,
  },
});

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: mockLocalStorageGetItem,
    setItem: mockLocalStorageSetItem,
    removeItem: mockLocalStorageRemoveItem,
    clear: mockLocalStorageClear,
  },
  writable: true,
});

// Mock window.close to prevent actual window closing in tests
Object.defineProperty(window, 'close', {
  value: jest.fn(),
  writable: true,
});

// NOW IMPORT THE REAL PAGE COMPONENTS AND ROUTES
import AuthPermissionsPage from '../src/core/routes/google/auth/permissions/page';

describe('Google Auth Pages - Real Components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    // Reset mock functions to stable state
    mockGet.mockImplementation((key: string) => {
      const params: Record<string, string> = {
        error: 'test_error',
        scopes: 'gmail.readonly,drive.readonly',
      };
      return params[key] || null;
    });
    mockHas.mockImplementation((key: string) => key === 'scopes');
    mockToString.mockReturnValue('error=test_error&scopes=gmail.readonly,drive.readonly');
  });

  // No explicit timer management needed; keep afterEach in case future cleanup required
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Permissions Page', () => {
    it('should render real permissions page component', async () => {
      const { container } = render(<AuthPermissionsPage />);
      await screen.findByTestId('gmail-permission-card');
      expect(container).toBeTruthy();
    });

    it('should display permission cards', async () => {
      render(<AuthPermissionsPage />);
      expect(await screen.findByTestId('gmail-permission-card')).toBeInTheDocument();
      expect(await screen.findByTestId('drive-permission-card')).toBeInTheDocument();
      expect(await screen.findByTestId('calendar-permission-card')).toBeInTheDocument();
    });

    it('should show loading state initially', () => {
      const { useIncrementalAuth } = require('../src/core/hooks/useIncrementalAuth.ts');
      useIncrementalAuth.mockReturnValue({
        checkScopes: jest.fn(() => new Promise(() => {})), // Never resolves
        requestScopes: jest.fn(),
        loading: true,
      });

      render(<AuthPermissionsPage />);
      // Component should show checking permissions message in loading state
      expect(screen.getByText('Checking permissions...')).toBeInTheDocument();
    });
    
    it('should exercise permissions page with different loading states', () => {
      // Test loading state
      const { useIncrementalAuth } = require('../src/core/hooks/useIncrementalAuth.ts');
      useIncrementalAuth.mockReturnValue({
        checkScopes: jest.fn(() => new Promise(() => {})), // Never resolves = loading
        requestScopes: jest.fn(),
        loading: true,
      });

      render(<AuthPermissionsPage />);
      // Check for loading message instead of shield icon
      expect(screen.getByText('Checking permissions...')).toBeInTheDocument();
    });
  });
});
