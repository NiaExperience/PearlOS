// Set up global polyfills FIRST, before any other imports
// @ts-expect-error: No type definitions for text-encoding  
import { TextEncoder, TextDecoder } from 'text-encoding';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder; // Cast needed for type compatibility

// Mock HTMLCanvasElement.getContext for libraries that need canvas (like @daily-co/daily-js)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
    fillRect: jest.fn(),
    clearRect: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Array(4) })),
    putImageData: jest.fn(),
    createImageData: jest.fn(),
    setTransform: jest.fn(),
    drawImage: jest.fn(),
    save: jest.fn(),
    fillText: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    stroke: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    rotate: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    measureText: jest.fn(() => ({ width: 0 })),
    transform: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
  });
}

// Mock  Daily.co libraries to prevent canvas-related issues
jest.mock('@daily-co/daily-js', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      join: jest.fn(),
      leave: jest.fn(),
      updateParticipant: jest.fn(),
      localVideo: jest.fn().mockReturnValue(false),
      localAudio: jest.fn().mockReturnValue(false),
      setLocalVideo: jest.fn(),
      setLocalAudio: jest.fn(),
      participants: jest.fn().mockReturnValue({}),
      on: jest.fn(),
      off: jest.fn(),
    })),
  };
});

import '@testing-library/jest-dom';

// Mock ESM-only 'jose' package (SignJWT) to avoid Jest ESM parsing issues in CommonJS ts-jest pipeline
// The real module ships pure ESM which was causing: Unexpected token 'export' when imported via ts-jest
// We only need minimal SignJWT usage for tests (token generation), so provide a lightweight mock.
jest.mock('jose', () => ({
  SignJWT: class MockSignJWT {
    private _payload: any;
    constructor(payload: any) { this._payload = payload; }
    setProtectedHeader() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    sign() { return Promise.resolve('mock.jwt.token'); }
  }
}));

// Mock 'server-only' package to allow server-side code to be tested
// The real package throws an error when imported in non-server environments
jest.mock('server-only', () => ({}));

// Mock Next.js font functions from next/font/google
// These functions are called with options and return an object with className property
// Used by: mode-card.tsx (Dosis), layout.tsx (Inter)
jest.mock('next/font/google', () => {
  // Create a mock font function that returns the expected structure
  const createMockFont = (fontName: string) => {
    return jest.fn((options?: any) => ({
      className: `mock-${fontName.toLowerCase()}-font`,
      style: {
        fontFamily: fontName,
      },
      variable: `--font-${fontName.toLowerCase()}`,
    }));
  };

  return {
    __esModule: true,
    Dosis: createMockFont('Dosis'),
    Inter: createMockFont('Inter'),
    // Add other Google fonts as needed when they're used
  };
});

// Mock NextAuth to prevent import errors during testing
jest.mock('next-auth', () => {
  return jest.fn(() => {
    // Return a function that can be used as both GET and POST handler
    const handler = jest.fn().mockResolvedValue({ 
      status: 200, 
      headers: new Headers(), 
      body: null 
    });
    return handler;
  });
});

// Polyfill ResizeObserver for jsdom environment (used by components with ResizeObserver)
if (typeof (global as any).ResizeObserver === 'undefined') {
  class MockResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  }
  ;(global as any).ResizeObserver = MockResizeObserver as any;
}

beforeEach(async () => {
  jest.clearAllMocks();
});

// Global fallback useSession mock (node or jsdom tests using this setup file)
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
} catch { /* ignore re-mock errors */ }

// Mock posthog-js/react
jest.mock('posthog-js/react', () => ({
  usePostHog: () => ({
    capture: jest.fn(),
    identify: jest.fn(),
    people: { set: jest.fn() },
    on: jest.fn(),
    isFeatureEnabled: jest.fn().mockReturnValue(false),
  }),
  PostHogProvider: ({ children }: { children: any }) => children,
}), { virtual: true });

// Mock posthog-js
jest.mock('posthog-js', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    capture: jest.fn(),
    identify: jest.fn(),
    reset: jest.fn(),
    people: {
      set: jest.fn(),
    },
  },
}), { virtual: true });

//
afterAll(async () => {
});
