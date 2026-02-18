/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import Chat from '../src/features/DailyCall/components/Chat';

// Mock scrollIntoView as it's not implemented in jsdom
Element.prototype.scrollIntoView = jest.fn();

// Mock Daily.co hooks
const mockDaily = {
  participants: jest.fn(() => ({
    local: { user_name: 'Test User' }
  })),
  room: jest.fn(() => 'https://test.daily.co/testroom'),
  sendAppMessage: jest.fn(() => Promise.resolve(true))
};

const mockLocalSessionId = 'test-session-123';

jest.mock('@daily-co/daily-react', () => ({
  useDaily: () => mockDaily,
  useDailyEvent: () => {},
  useLocalSessionId: () => mockLocalSessionId
}));

// Mock fetch for admin API
global.fetch = jest.fn();

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('Chat Component - Stealth Mode & Admin Controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 'success',
        mode: 'queued',
        delivery_time: new Date().toISOString()
      })
    });
  });

  describe('Admin User Defaults', () => {
    it('should default admin users to bot mode', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Admin users should have bot mode selected by default
      const botModeRadio = screen.getByRole('radio', { name: /bot/i });
      expect(botModeRadio).toBeChecked();
    });

    it('should default non-admin users to room mode', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={false}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Non-admin users don't see admin controls, but use room messaging by default
      // Verify they see the standard message input
      expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument();
      
      // Verify no admin controls are visible
      expect(screen.queryByText(/destination:/i)).not.toBeInTheDocument();
    });
  });

  describe('Stealth Mode Protection', () => {
    it('should block room messages in stealth mode and show feedback', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={true}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // In stealth mode, room should be disabled - verify this
      const roomModeRadio = screen.getByRole('radio', { name: /room/i });
      expect(roomModeRadio).toBeDisabled();

      // Bot mode should be selected by default
      const botModeRadioStealth = screen.getByRole('radio', { name: /bot/i });
      expect(botModeRadioStealth).toBeChecked();

      // Enter a message (should show bot command placeholder)
      const messageInput = screen.getByPlaceholderText(/send command to bot/i);
      fireEvent.change(messageInput, { target: { value: 'Test stealth message' } });

      // Since we're in bot mode, this should call the admin API, not Daily.co
      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      // Should call admin API for bot messages
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/bot/admin', expect.any(Object));
      });

      // Should not call Daily.co sendAppMessage
      expect(mockDaily.sendAppMessage).not.toHaveBeenCalled();

      // Should not call Daily.co sendAppMessage
      expect(mockDaily.sendAppMessage).not.toHaveBeenCalled();
      
      // Should force switch back to bot mode
      const botModeRadio = screen.getByRole('radio', { name: /bot/i });
      expect(botModeRadio).toBeChecked();
    });

    it('should allow bot messages in stealth mode', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={true}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Bot mode should be selected by default for admin in stealth
      const botModeRadio2 = screen.getByRole('radio', { name: /bot/i });
      expect(botModeRadio2).toBeChecked();

      // Enter a message - should show bot command placeholder
      const messageInput = screen.getByPlaceholderText(/send command to bot/i);
      fireEvent.change(messageInput, { target: { value: 'Test bot message' } });

      // Send the message
      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      // Should call admin API, not Daily.co
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/bot/admin', expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-room-url': 'https://test.daily.co/testroom'
          }),
          body: expect.stringContaining('Test bot message')
        }));
      });

      expect(mockDaily.sendAppMessage).not.toHaveBeenCalled();
    });
  });

  describe('Admin Message Routing', () => {
    it('should send admin bot messages via Redis API', async () => {
      render(
        <Chat 
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={false}
        />
      );

      // Bot mode should be selected by default
      const botModeRadio2 = screen.getByRole('radio', { name: /bot/i });
      expect(botModeRadio2).toBeChecked();

      // Enter a message
      const messageInput = screen.getByPlaceholderText(/send command to bot/i);
      await userEvent.type(messageInput, 'Test admin command');

      // Send the message
      await userEvent.click(screen.getByRole('button', { name: /send command to bot/i }));

      // Should call admin API
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/bot/admin', expect.any(Object));
      });
    });

    it('should send room messages via Daily.co for non-stealth users', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={false}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Non-admin users should not have radio controls
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();

      // Enter a message
      const messageInput = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(messageInput, { target: { value: 'Regular room message' } });

      // Send the message
      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      // Should call Daily.co sendAppMessage
      await waitFor(() => {
        expect(mockDaily.sendAppMessage).toHaveBeenCalledWith({
          type: 'chat-message',
          message: 'Regular room message',
          senderName: 'Test User'
        });
      });

      // Should NOT call admin API
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Content Filtering', () => {
    it('should block abusive content and show warning', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={false}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Enter a message with abusive content
      const messageInput = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(messageInput, { target: { value: 'This is fucking stupid' } });

      // Send the message
      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      // Should show content filter warning
      await waitFor(() => {
        expect(screen.getByText(/message blocked.*inappropriate content/i)).toBeInTheDocument();
      });

      // Should not send any message
      expect(mockDaily.sendAppMessage).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('UI State Management', () => {
    it('should show disabled indicator for room mode in stealth', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={true}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Room radio should be disabled in stealth mode
      const roomModeRadio = screen.getByRole('radio', { name: /room/i });
      expect(roomModeRadio).toBeDisabled();

      // Should show disabled indicator text
      expect(screen.getByText(/disabled in stealth/i)).toBeInTheDocument();
    });

    it('should clear message input after successful send', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Enter and send a bot message
      const messageInput = screen.getByPlaceholderText(/send command to bot/i);
      fireEvent.change(messageInput, { target: { value: 'Test message' } });
      
      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      // Input should be cleared after send
      await waitFor(() => {
        expect(messageInput).toHaveValue('');
      });
    });

    it('should handle Enter key to send messages', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Bot mode should be selected by default for admin
      const botModeRadio = screen.getByRole('radio', { name: /bot/i });
      expect(botModeRadio).toBeChecked();

      // Enter a message
      const messageInput = screen.getByPlaceholderText(/send command to bot/i);
      await userEvent.type(messageInput, 'Enter key test');

      // Press Enter to send
      await userEvent.keyboard('{Enter}');

      // Should call admin API
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/bot/admin', expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('Enter key test')
        }));
      }, { timeout: 3000 });
    });
  });

  describe('Error Handling', () => {
    it('should handle admin API failures gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' })
      });

      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={true}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Enter and send a bot message
      const messageInput = screen.getByPlaceholderText(/send command to bot/i);
      fireEvent.change(messageInput, { target: { value: 'Test error handling' } });
      
      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText(/failed to send admin message/i)).toBeInTheDocument();
      });
    });

    it('should prevent non-admin users from sending bot messages', async () => {
      render(
        <Chat
          isVisible={true}
          onClose={() => {}}
          isAdmin={false}
          stealth={false}
          roomUrl="https://test.daily.co/testroom"
        />
      );

      // Non-admin users should not have radio controls to switch modes
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();

      // Enter a message
      const messageInput = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(messageInput, { target: { value: 'Unauthorized bot message' } });

      // Send the message
      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      // Should not call admin API (since user is not admin)
      await waitFor(() => {
        expect(global.fetch).not.toHaveBeenCalledWith('/api/bot/admin', expect.any(Object));
      });

      // Message should appear in chat (as regular room message)
      await waitFor(() => {
        expect(screen.getByText('Unauthorized bot message')).toBeInTheDocument();
      });

      // Should send via Daily.co (room message), but NOT via admin API
      expect(mockDaily.sendAppMessage).toHaveBeenCalledWith({
        message: 'Unauthorized bot message',
        senderName: 'Test User',
        type: 'chat-message'
      });
      expect(global.fetch).not.toHaveBeenCalledWith('/api/bot/admin', expect.any(Object));
      });
    });
});