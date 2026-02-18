/**
 * @jest-environment jsdom
 */

// Mock DOM methods
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: jest.fn(),
  writable: true,
});

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import Chat from '../components/Chat';

// Mock Daily.co hooks
jest.mock('@daily-co/daily-react', () => ({
  useDaily: () => ({
    participants: () => ({ local: { user_name: 'Test User' } }),
    sendAppMessage: jest.fn(),
  }),
  useDailyEvent: () => {},
  useLocalSessionId: () => 'test-session-id',
}));

describe('Chat Admin Controls', () => {
  const defaultProps = {
    isVisible: true,
    onClose: jest.fn(),
    roomUrl: 'https://test.daily.co/room',
    onUnreadCountChange: jest.fn(),
  };

  beforeEach(() => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      },
      writable: true,
    });
  });

  it('shows admin controls when isAdmin is true', () => {
    render(<Chat {...defaultProps} isAdmin={true} />);
    
    expect(screen.getByText('Destination:')).toBeInTheDocument();
    expect(screen.getByText('Mode:')).toBeInTheDocument();
    expect(screen.getByDisplayValue('room')).toBeInTheDocument();
    expect(screen.getByDisplayValue('bot')).toBeInTheDocument();
  });

  it('hides admin controls when isAdmin is false', () => {
    render(<Chat {...defaultProps} isAdmin={false} />);
    
    expect(screen.queryByText('Destination:')).not.toBeInTheDocument();
    expect(screen.queryByText('Mode:')).not.toBeInTheDocument();
  });

  it('disables room option in stealth mode', () => {
    render(<Chat {...defaultProps} isAdmin={true} stealth={true} />);
    
    const roomRadio = screen.getByDisplayValue('room');
    const botRadio = screen.getByDisplayValue('bot');
    
    expect(roomRadio).toBeDisabled();
    expect(botRadio).not.toBeDisabled();
  });

  it('defaults to bot mode when in stealth', () => {
    render(<Chat {...defaultProps} isAdmin={true} stealth={true} />);
    
    const botRadio = screen.getByDisplayValue('bot');
    expect(botRadio).toBeChecked();
  });

  it('enables mode options when destination is bot (default for admin)', () => {
    render(<Chat {...defaultProps} isAdmin={true} />);
    
    // Admin users default to bot mode, so mode options should be enabled
    const queuedRadio = screen.getByDisplayValue('queued');
    const immediateRadio = screen.getByDisplayValue('immediate');
    
    expect(queuedRadio).not.toBeDisabled();
    expect(immediateRadio).not.toBeDisabled();
  });

  it('shows correct initial state for admin users (bot mode selected)', async () => {
    render(<Chat {...defaultProps} isAdmin={true} />);
    
    // Admin users should default to bot mode with mode options enabled
    const botRadio = screen.getByDisplayValue('bot');
    const roomRadio = screen.getByDisplayValue('room');
    const queuedRadio = screen.getByDisplayValue('queued');
    const immediateRadio = screen.getByDisplayValue('immediate');
    
    expect(botRadio).toBeChecked();
    expect(roomRadio).not.toBeChecked();
    expect(queuedRadio).not.toBeDisabled();
    expect(immediateRadio).not.toBeDisabled();
    expect(screen.getByPlaceholderText('Send command to bot...')).toBeInTheDocument();
  });

  it('shows correct initial state for non-admin users (no admin controls)', async () => {
    render(<Chat {...defaultProps} isAdmin={false} />);
    
    // Non-admin users should not see admin controls at all
    expect(screen.queryByDisplayValue('bot')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('room')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('queued')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('immediate')).not.toBeInTheDocument();
    
    // Non-admin users should have basic messaging interface
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
    expect(screen.getByTitle('Send message')).toBeInTheDocument();
  });
});