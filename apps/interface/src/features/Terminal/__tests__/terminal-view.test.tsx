/**
 * @jest-environment jsdom
 */

/**
 * Smoke test: TerminalView accepts a command and echoes output.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TerminalView from '../components/TerminalView';

// Mock fetch so the initial pwd call doesn't fail in test environment
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ stdout: '/root\n', stderr: '', exitCode: 0, cwd: '/root' }),
  } as Response)
);

// Mock posthog
jest.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: jest.fn() }),
}));

describe('TerminalView', () => {
  it('executes help command', () => {
    render(<TerminalView />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'help' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    // Multiple lines contain similar wording; ensure the help output appears somewhere.
    expect(screen.getAllByText(/Available commands/i).length).toBeGreaterThan(0);
  });
});
