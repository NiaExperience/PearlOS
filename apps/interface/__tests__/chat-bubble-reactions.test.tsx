/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import ChatBubble, { type ChatReactionEmoji, type ChatMessage } from '../src/features/ChatMode/components/ChatBubble';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    return React.createElement(React.Fragment, null, children);
  },
}));

describe('ChatBubble reactions', () => {
  it('reveals reactions for Pearl messages only on hover and emits selected carousel emoji', async () => {
    const onReaction = jest.fn();
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'That worked.',
      timestamp: Date.now(),
      reactions: [{ by: 'user', emoji: '✨' }],
    };

    const { container } = render(React.createElement(ChatBubble, { message, onReaction }));

    expect(screen.getByLabelText('You reaction options')).not.toBeVisible();
    const activeReaction = container.querySelector('button[aria-label="Remove ✨ reaction from You"]');
    expect(activeReaction).not.toBeNull();
    expect(activeReaction).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Change You reaction' })).not.toBeInTheDocument();

    fireEvent.mouseOver(container.firstElementChild!);
    const trigger = await screen.findByRole('button', { name: 'Change You reaction' });
    await waitFor(() => expect(trigger).toBeVisible());

    fireEvent.click(trigger);
    expect(screen.queryByLabelText('Search emoji')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'React 🎉' }));

    expect(onReaction).toHaveBeenLastCalledWith('assistant-1', '🎉' satisfies ChatReactionEmoji);
  });

  it('opens Pearl reaction controls for Blair messages only from the lower quarter tap zone', async () => {
    const onReaction = jest.fn();
    const message: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: 'Nice.',
      timestamp: Date.now(),
    };

    const { container } = render(React.createElement(ChatBubble, { message, onReaction }));
    const bubble = screen.getByText('Nice.').closest('.relative') as HTMLElement;
    jest.spyOn(bubble, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      bottom: 80,
      right: 240,
      width: 240,
      height: 80,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    expect(screen.getByLabelText('Pearl reaction options')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add Pearl reaction' })).not.toBeInTheDocument();

    fireEvent.touchStart(bubble, { touches: [{ clientY: 20 }] });
    expect(screen.queryByRole('button', { name: 'Add Pearl reaction' })).not.toBeInTheDocument();

    fireEvent.touchStart(bubble, { touches: [{ clientY: 70 }] });
    const trigger = await screen.findByRole('button', { name: 'Add Pearl reaction' });
    await waitFor(() => expect(trigger).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'React 👍' }));
    expect(onReaction).toHaveBeenLastCalledWith('user-1', '👍' satisfies ChatReactionEmoji);

    fireEvent.touchStart(bubble, { touches: [{ clientY: 20 }] });
    expect(screen.queryByRole('button', { name: 'Add Pearl reaction' })).not.toBeInTheDocument();
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it('shows Pearl reactions on Blair messages with Pearl ownership labels', async () => {
    const message: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: 'Nice.',
      timestamp: Date.now(),
      reactions: [{ by: 'assistant', emoji: '👍' }],
    };

    const { container } = render(React.createElement(ChatBubble, { message, onReaction: jest.fn() }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove 👍 reaction from Pearl' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Change Pearl reaction' })).not.toBeInTheDocument();
    expect(screen.getByText('👍')).toBeInTheDocument();
    fireEvent.mouseOver(container.firstElementChild!);
    expect(screen.getByRole('button', { name: 'Change Pearl reaction' })).toBeVisible();
    expect(screen.getByText('Nice.').closest('.relative')).toHaveStyle({ backgroundColor: '#d8efff' });
  });

  it('uses a compact horizontally scrollable carousel on mobile viewports', async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const originalVisualViewport = window.visualViewport;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 375,
        height: 500,
        offsetLeft: 0,
        offsetTop: 0,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    });

    const message: ChatMessage = {
      id: 'assistant-mobile',
      role: 'assistant',
      content: 'Mobile emoji.',
      timestamp: Date.now(),
    };

    try {
      const { container } = render(React.createElement(ChatBubble, { message, onReaction: jest.fn() }));
      fireEvent.mouseOver(container.firstElementChild!);
      const trigger = await screen.findByRole('button', { name: 'Add You reaction' });
      fireEvent.click(trigger);

      expect(screen.queryByLabelText('Search emoji')).not.toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'React 🎉' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'React 🫶' })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalVisualViewport });
    }
  });
});
