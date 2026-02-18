/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';

// Ensure BrowserAutomation flag gating returns disabled notice when flag off

describe('BrowserAutomation feature flag', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_FEATURE_BROWSERAUTOMATION: 'false' };
    try {
      const ffPath = require.resolve('@nia/features');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete require.cache[ffPath as any];
    } catch {
      // ignore
    }
  });
  afterEach(() => { process.env = originalEnv; });

  it('renders disabled message when flag is false', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: RealBrowserView } = require('../components/RealBrowserView');
    render(<RealBrowserView sessionId="test"/>);
    expect(screen.getByText(/browser automation disabled/i)).toBeInTheDocument();
  });
});
