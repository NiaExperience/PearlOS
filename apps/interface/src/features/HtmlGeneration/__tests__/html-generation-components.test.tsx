/**
 * @jest-environment jsdom
 */
// Load shared frontend jest setup (polyfills like ResizeObserver)
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../../../../../../jest.setup.frontend');
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import HtmlGenerationToggle from '../components/HtmlGenerationToggle';
import { HtmlGenerationViewer } from '../components/HtmlGenerationViewer';

// Mock next-auth session hook so components using useResilientSession don't require a provider
jest.mock('next-auth/react', () => {
  return {
    // Minimal authenticated session shape expected by hooks/components
    useSession: () => ({
      data: {
        user: { id: 'test-user-id', email: 'test@example.com', name: 'Tester' }
      },
      status: 'authenticated'
    }),
    // No-op provider passthrough
    SessionProvider: ({ children }: any) => children,
    signIn: jest.fn(),
    signOut: jest.fn()
  };
});

// Mock voice session context to satisfy HtmlGenerationViewer dependencies
jest.mock('@interface/contexts/voice-session-context', () => ({
  useVoiceSessionContext: () => ({ callStatus: 'active', roomUrl: 'https://example.test/room' }),
}));

// Mock the heavy HtmlContentViewer dependency to isolate pass-through behavior
jest.mock('@interface/features/HtmlGeneration/components/HtmlContentViewer', () => {
  const ReactLocal = require('react');
  return {
    HtmlContentViewer: ({ appletTitle, htmlContent, contentType, onClose, isFullscreen, onToggleFullscreen }: any) => (
      ReactLocal.createElement(
        'div',
        { 'data-testid': 'mock-viewer' },
        ReactLocal.createElement('span', { 'data-testid': 'viewer-title' }, appletTitle),
        ReactLocal.createElement('span', { 'data-testid': 'viewer-type' }, contentType),
        ReactLocal.createElement('span', { 'data-testid': 'viewer-fullscreen' }, String(isFullscreen)),
        ReactLocal.createElement('div', { 'data-testid': 'viewer-html', dangerouslySetInnerHTML: { __html: htmlContent } }),
        ReactLocal.createElement('button', { onClick: onClose }, 'close'),
        ReactLocal.createElement('button', { onClick: onToggleFullscreen }, 'toggle')
      )
    )
  };
});

describe('HtmlGeneration components', () => {
  describe('HtmlGenerationToggle', () => {
    it('defaults to fast mode and confirms with useOpenAI=true', () => {
      const onClose = jest.fn();
      const onConfirm = jest.fn();
      render(
        <HtmlGenerationToggle
          isOpen
          onClose={onClose}
            onConfirm={onConfirm}
          title="Test Title"
          description="Desc"
        />
      );
      const generateBtn = screen.getByRole('button', { name: /Generate with Fast Engine/i });
      fireEvent.click(generateBtn);
      expect(onConfirm).toHaveBeenCalledWith(true); // fast => useOpenAI true
      expect(onClose).toHaveBeenCalled();
    });

    it('selects advanced mode via card click and confirms with useOpenAI=false', () => {
      const onClose = jest.fn();
      const onConfirm = jest.fn();
      render(
        <HtmlGenerationToggle
          isOpen
          onClose={onClose}
          onConfirm={onConfirm}
          title="Test Title"
          description="Desc"
        />
      );
      // Click advanced card (contains text 'Advanced')
      const advancedCard = screen.getByText('Advanced').closest('div');
      expect(advancedCard).toBeTruthy();
      fireEvent.click(advancedCard!);
      const generateBtn = screen.getByRole('button', { name: /Generate with Advanced Engine/i });
      fireEvent.click(generateBtn);
      expect(onConfirm).toHaveBeenCalledWith(false); // advanced => useOpenAI false
    });
  });

  describe('HtmlGenerationViewer', () => {
    it('renders pass-through props to HtmlContentViewer', () => {
      const onClose = jest.fn();
      const onToggleFullscreen = jest.fn();
      render(
        <HtmlGenerationViewer
          htmlGeneration={{
            page_id: 'id1',
            title: 'Viewer Title',
            htmlContent: '<p>Sample</p>',
            contentType: 'game',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tenantId: 'tenant',
            isAiGenerated: true
          } as any}
          onClose={onClose}
          isFullscreen={false}
          onToggleFullscreen={onToggleFullscreen}
        />
      );
      expect(screen.getByTestId('viewer-title').textContent).toBe('Viewer Title');
      expect(screen.getByTestId('viewer-type').textContent).toBe('game');
      expect(screen.getByTestId('viewer-html').innerHTML).toContain('Sample');
    });
  });
});
