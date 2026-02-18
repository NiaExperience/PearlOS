// Setup for frontend/React component tests (jsdom environment)
import '@testing-library/jest-dom';

// Set up global polyfills for jsdom environment
// @ts-expect-error: No type definitions for text-encoding
import { TextEncoder, TextDecoder } from 'text-encoding';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

// Mock window.matchMedia for components that use it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock ResizeObserver if needed
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mute console output for frontend tests unless needed
if (process.env.MUTE_LOGS !== 'false') {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
}

// Provide a default mock for useSession so component tests need not wrap SessionProvider everywhere.
// Individual tests can override by mocking 'next-auth/react' again locally.
try {
  jest.mock('next-auth/react', () => {
    const defaultSession = { data: { user: { id: 'test-user-id', email: 'test@example.com' } }, status: 'authenticated' };
    const useSession = jest.fn(() => defaultSession);
    return {
      __esModule: true,
      useSession,
      signIn: jest.fn(),
      signOut: jest.fn()
    };
  });
} catch { /* ignore double mock */ }
