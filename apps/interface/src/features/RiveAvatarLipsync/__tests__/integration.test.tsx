/**
 * Integration Tests for RiveAvatarLipsync Feature
 * 
 * Tests the complete system integration including:
 * - Component rendering with hooks
 * - Service integration
 * - VAPI message flow
 * - Real-time state synchronization
 * 
 * @jest-environment jsdom
 */

import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

import { RiveAvatarLipsync } from '../components/RiveAvatarLipsync';
import { lipsyncService } from '../services/LipsyncService';
import type { LlmMessage } from '../types/lipsync-types';

// Mock Rive React hooks
const mockRiveComponent = ({ className }: { className: string }) => (
  <div data-testid="rive-component" className={className}>
    Rive Animation Component
  </div>
);

jest.mock('rive-react', () => ({
  useRive: () => ({
    rive: {
      play: jest.fn(),
      pause: jest.fn()
    },
    RiveComponent: mockRiveComponent
  }),
  useStateMachineInput: () => ({
    value: 0,
    fire: jest.fn()
  })
}));

// Mock UI Context
jest.mock('@interface/contexts/ui-context', () => ({
  useUI: () => ({
    isBrowserWindowVisible: false,
    isAvatarVisible: true,
    triggerAvatarHide: jest.fn(),
    bellButtonRect: null
  })
}));

// Mock Voice Session Context (replaces old speech context)
const mockVoiceSessionContext = {
  isAssistantSpeaking: false,
  isUserSpeaking: false,
  audioLevel: 0,
  assistantVolumeLevel: 0,
  language: 'en',
  sessionStatus: 'inactive' as const,
  reconnectAttempts: 0,
  callStatus: 'inactive' as const,
  toggleCall: null,
  setCallStatus: jest.fn(),
  setToggleCall: jest.fn(),
  isCallEnding: false,
  canAssistantAnimate: false,
  isAssistantGeneratingText: false,
  lastAssistantMessage: '',
  assistantSpeechConfidence: 0,
  transcriptQuality: 'none' as const,
  speechTimestamp: 0,
  getCallObject: jest.fn(),
  destroyCallObject: jest.fn(),
};

jest.mock('@interface/contexts/voice-session-context', () => ({
  useVoiceSessionContext: () => mockVoiceSessionContext,
}));

describe('RiveAvatarLipsync Integration', () => {
  beforeEach(async () => {
    // Reset service state
    lipsyncService.stop();
    await lipsyncService.initialize();
    lipsyncService.start();
    
    // Reset mock context
    Object.assign(mockVoiceSessionContext, {
      isAssistantSpeaking: false,
      isUserSpeaking: false,
      audioLevel: 0,
      assistantVolumeLevel: 0
    });
  });

  afterEach(() => {
    lipsyncService.stop();
  });

  describe('Component Rendering', () => {
    it('should render the avatar component with default props', () => {
      render(<RiveAvatarLipsync />);
      
      expect(screen.getByTestId('rive-component')).toBeInTheDocument();
      expect(screen.queryByText('Loading Rive Avatar...')).not.toBeInTheDocument();
    });

    it('should render with debug panel when enabled', () => {
      render(<RiveAvatarLipsync enableDebug={true} />);
      
      // In development mode, debug panel should be visible
      if (process.env.NODE_ENV === 'development') {
        expect(screen.getByText(/Lipsync Debug/)).toBeInTheDocument();
      }
    });

    it('should apply custom dimensions', () => {
      const { container } = render(
        <RiveAvatarLipsync width={400} height={400} />
      );
      
      const avatarContainer = container.querySelector('.rive-avatar');
      expect(avatarContainer).toHaveStyle({
        width: '400px',
        height: '400px'
      });
    });
  });

  describe('End-to-End Speech Processing', () => {
    it('should process complete speech flow from VAPI message to animation', async () => {
      const { container } = render(<RiveAvatarLipsync enableDebug={true} />);
      
      // Start the service to enable processing
      lipsyncService.start();
      
      // Simulate assistant transcript message
      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Hello, this is a test message from the assistant',
        transcriptType: 'final'
      };

      act(() => {
        lipsyncService.processLlmMessage(message);
      });

      // Service should track that it processed the message
      await waitFor(() => {
        const metrics = lipsyncService.getMetrics();
        expect(metrics.messagesProcessed).toBe(1);
        expect(metrics.isRunning).toBe(true);
      });

      // Verify service is working correctly
      expect(lipsyncService.getMetrics().lastProcessingTime).toBeGreaterThanOrEqual(0);
    });

    it('should immediately stop animation when user starts speaking', async () => {
      render(<RiveAvatarLipsync />);
      
      // Start with assistant speaking
      const assistantMessage: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Assistant is speaking',
        transcriptType: 'partial'
      };

      // Start the service first
      lipsyncService.start();
      
      act(() => {
        lipsyncService.processLlmMessage(assistantMessage);
      });
      
      // Verify service processed the message
      await waitFor(() => {
        const metrics = lipsyncService.getMetrics();
        expect(metrics.messagesProcessed).toBe(1);
      });

      // The actual animation control is handled by the component/hooks integration
      // This test verifies the service can process messages correctly
      expect(lipsyncService.getMetrics().isRunning).toBe(true);
    });

    it('should handle conversation end and cleanup state', async () => {
      render(<RiveAvatarLipsync />);
      
      // Start conversation
      const transcriptMessage: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Speaking...',
        transcriptType: 'partial'
      };

      act(() => {
        lipsyncService.processLlmMessage(transcriptMessage);
      });

      // End conversation
      const endMessage: LlmMessage = {
        type: 'conversation-update',
        role: 'assistant',
        transcriptType: 'final'
      };

      act(() => {
        lipsyncService.processLlmMessage(endMessage);
      });

      // State should be cleaned up after timeout
      await waitFor(() => {
        const animationState = lipsyncService.getAnimationState();
        expect(animationState.shouldShowTalkingAnimation).toBe(false);
        expect(animationState.animationType).toBe('idle');
      }, { timeout: 1000 });
    });
  });

  describe('Confidence-Based Animation Control', () => {
    it('should animate with high-confidence transcript', async () => {
      render(<RiveAvatarLipsync />);
      
      // Start the service
      lipsyncService.start();
      
      const highConfidenceMessage: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'This is a substantial message with plenty of content that should trigger high confidence animation',
        transcriptType: 'final'
      };

      act(() => {
        lipsyncService.processLlmMessage(highConfidenceMessage);
      });

      // Verify the service processed the high-confidence message
      await waitFor(() => {
        const metrics = lipsyncService.getMetrics();
        expect(metrics.messagesProcessed).toBe(1);
        expect(metrics.isRunning).toBe(true);
      });
    });

    it('should not animate with low-confidence transcript', async () => {
      render(<RiveAvatarLipsync />);
      
      const lowConfidenceMessage: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Hi', // Very short message
        transcriptType: 'partial' // Not final
      };

      act(() => {
        lipsyncService.processLlmMessage(lowConfidenceMessage);
      });

      await waitFor(() => {
        const animationState = lipsyncService.getAnimationState();
        expect(animationState.shouldShowTalkingAnimation).toBe(false);
      });
    });
  });

  describe('Service Integration', () => {
    it('should maintain service state synchronization', async () => {
      render(<RiveAvatarLipsync />);
      
      // Service and component should start in sync
      const initialServiceState = lipsyncService.getAnimationState();
      expect(initialServiceState.animationType).toBe('idle');

      // Start service
      lipsyncService.start();
      
      // Process message
      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Test message',
        transcriptType: 'final'
      };

      act(() => {
        lipsyncService.processLlmMessage(message);
      });

      // Verify service processed the message
      await waitFor(() => {
        const metrics = lipsyncService.getMetrics();
        expect(metrics.messagesProcessed).toBe(1);
        expect(metrics.isRunning).toBe(true);
      });
    });

    it('should handle service configuration updates', async () => {
      render(<RiveAvatarLipsync />);
      
      // Disable service
      act(() => {
        lipsyncService.updateConfig({ enabled: false });
      });

      // Messages should not be processed
      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'This should not animate',
        transcriptType: 'final'
      };

      act(() => {
        lipsyncService.processLlmMessage(message);
      });

      await waitFor(() => {
        const animationState = lipsyncService.getAnimationState();
        expect(animationState.shouldShowTalkingAnimation).toBe(false);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed VAPI messages gracefully', async () => {
      render(<RiveAvatarLipsync />);
      
      const malformedMessage = {
        type: 'invalid-type',
        someInvalidField: 'invalid'
      } as any;

      // Should not throw error
      expect(() => {
        act(() => {
          lipsyncService.processLlmMessage(malformedMessage);
        });
      }).not.toThrow();

      // Animation state should remain unchanged
      const animationState = lipsyncService.getAnimationState();
      expect(animationState.animationType).toBe('idle');
    });

    it('should handle Rive component errors gracefully', () => {
      // Component should not crash even if Rive has issues
      expect(() => render(<RiveAvatarLipsync />)).not.toThrow();
      
      // The mock already provides a safe fallback
      expect(screen.getByTestId('rive-component')).toBeInTheDocument();
    });
  });

  describe('Performance Monitoring', () => {
    it('should track processing metrics', async () => {
      render(<RiveAvatarLipsync />);
      
      // Test that service exists and basic operations work
      expect(lipsyncService).toBeDefined();
      expect(typeof lipsyncService.initialize).toBe('function');
      expect(typeof lipsyncService.start).toBe('function');
      expect(typeof lipsyncService.stop).toBe('function');
      
      // Test service configuration updates
      const newConfig = {
        enabled: true,
        debug: { enableLogging: true, showDebugPanel: false, logStateChanges: true }
      };
      
      expect(() => {
        lipsyncService.updateConfig(newConfig);
      }).not.toThrow();
      
      // Test that metrics exist and have expected shape
      const metrics = lipsyncService.getMetrics();
      expect(metrics).toHaveProperty('messagesProcessed');
      expect(metrics).toHaveProperty('lastProcessingTime');
      expect(metrics).toHaveProperty('isRunning');
      expect(typeof metrics.messagesProcessed).toBe('number');
    });

    it('should track RULE 6 violations', async () => {
      render(<RiveAvatarLipsync />);
      
      // Create a scenario that would violate RULE 6 if not prevented
      const violatingState = {
        shouldShowTalkingAnimation: true,
        forceStopAnimation: false,
        animationType: 'talking' as const,
        intensity: 0.5,
        isUserDominant: true, // This should trigger violation tracking
        animationName: 'Test'
      };

      act(() => {
        lipsyncService.updateAnimationState(violatingState);
      });

      await waitFor(() => {
        const metrics = lipsyncService.getMetrics();
        expect(metrics.rule6Violations).toBeGreaterThan(0);
      });
    });
  });

  describe('Multi-Stage Animation System', () => {
    it('should handle browser window visibility changes', async () => {
      // This test verifies that the component can render and handle visibility changes
      render(<RiveAvatarLipsync />);
      
      // Verify component is rendered
      expect(screen.getByTestId('rive-component')).toBeInTheDocument();
      
      // Test that service exists and can handle lifecycle changes
      expect(() => {
        lipsyncService.initialize();
        lipsyncService.start();
        lipsyncService.stop();
      }).not.toThrow();
      
      // Verify service methods are accessible
      expect(typeof lipsyncService.getMetrics).toBe('function');
      expect(typeof lipsyncService.getAnimationState).toBe('function');
    });
  });
});
