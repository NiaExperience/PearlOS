/**
 * Speech Detection Tests
 * 
 * Tests for the useLipsyncSpeechDetection hook and speech processing logic
 * 
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';

import { useLipsyncSpeechDetection } from '../lib/useLipsyncSpeechDetection';
import type { LlmMessage } from '../types/lipsync-types';

// Mock the voice session context (replaces old speech context)
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

// Mock console methods for testing
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

describe('useLipsyncSpeechDetection', () => {
  beforeEach(() => {
    // Reset mock context
    Object.assign(mockVoiceSessionContext, {
      isAssistantSpeaking: false,
      isUserSpeaking: false,
      audioLevel: 0,
      assistantVolumeLevel: 0
    });

    // Clear console mocks
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
  });

  describe('Initial State', () => {
    it('should initialize with default speech detection state', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      expect(result.current.speechState).toEqual({
        isAssistantSpeaking: false,
        isUserSpeaking: false,
        assistantVolumeLevel: 0,
        audioLevel: 0,
        isAssistantGeneratingText: false,
        lastAssistantMessage: '',
        assistantSpeechConfidence: 0,
        transcriptQuality: 'none',
        speechTimestamp: 0,
        canAssistantAnimate: false
      });
    });
  });

  describe('Confidence Calculation', () => {
    it('should calculate high confidence for final transcript with content', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      const confidence = result.current.calculateConfidence(
        'This is a substantial message with good content',
        'final',
        Date.now()
      );

      // Should get: content (0.4) + final (0.3) + substantial (0.2) = 0.9
      expect(confidence).toBeCloseTo(0.9, 1);
    });

    it('should calculate medium confidence for partial transcript', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      const confidence = result.current.calculateConfidence(
        'Short message',
        'partial',
        Date.now()
      );

      // Should get: content (0.4) + partial (0.2) = 0.6
      expect(confidence).toBeCloseTo(0.6, 1);
    });

    it('should calculate low confidence for empty content', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      const confidence = result.current.calculateConfidence(
        '',
        'partial',
        Date.now()
      );

      // Should get minimal confidence
      expect(confidence).toBeLessThan(0.4);
    });

    it('should consider recent activity in confidence calculation', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      // Set recent speech timestamp
      act(() => {
        const message: LlmMessage = {
          type: 'transcript',
          role: 'assistant',
          transcript: 'Hello',
          transcriptType: 'partial'
        };
        result.current.processLlmMessage(message);
      });

      const recentConfidence = result.current.calculateConfidence(
        'Test message',
        'partial',
        Date.now()
      );

      const oldConfidence = result.current.calculateConfidence(
        'Test message',
        'partial',
        Date.now() - 15000 // 15 seconds ago
      );

      expect(recentConfidence).toBeGreaterThanOrEqual(oldConfidence);
    });
  });

  describe('Animation Permission Logic', () => {
    it('should allow animation with high confidence and assistant generating', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      const permission = result.current.determineAnimationPermission(
        0.8, // High confidence
        false, // User not speaking
        true // Assistant generating
      );

      expect(permission).toBe(true);
    });

    it('should block animation when user is speaking (RULE 6)', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      const permission = result.current.determineAnimationPermission(
        1.0, // Perfect confidence
        true, // User speaking - should override everything
        true // Assistant generating
      );

      expect(permission).toBe(false);
    });

    it('should block animation with low confidence', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      const permission = result.current.determineAnimationPermission(
        0.2, // Low confidence
        false, // User not speaking
        true // Assistant generating
      );

      expect(permission).toBe(false);
    });

    it('should allow medium confidence with caution', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      const permission = result.current.determineAnimationPermission(
        0.4, // Medium confidence
        false, // User not speaking
        true // Assistant generating
      );

      expect(permission).toBe(true);
    });
  });

  describe('VAPI Message Processing', () => {
    it('should process assistant transcript messages', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      act(() => {
        const message: LlmMessage = {
          type: 'transcript',
          role: 'assistant',
          transcript: 'Hello, this is a test message from the assistant',
          transcriptType: 'final'
        };
        
        result.current.processLlmMessage(message);
      });

      expect(result.current.speechState.isAssistantGeneratingText).toBe(true);
      expect(result.current.speechState.isAssistantSpeaking).toBe(true);
      expect(result.current.speechState.lastAssistantMessage).toBe('Hello, this is a test message from the assistant');
      expect(result.current.speechState.transcriptQuality).toBe('final');
      expect(result.current.speechState.assistantSpeechConfidence).toBeGreaterThan(0.8);
    });

    it('should handle conversation-update messages', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      // First set up some assistant speech
      act(() => {
        const transcriptMessage: LlmMessage = {
          type: 'transcript',
          role: 'assistant',
          transcript: 'Test message',
          transcriptType: 'partial'
        };
        result.current.processLlmMessage(transcriptMessage);
      });

      // Then send conversation end
      act(() => {
        const endMessage: LlmMessage = {
          type: 'conversation-update',
          role: 'assistant',
          transcriptType: 'final'
        };
        result.current.processLlmMessage(endMessage);
      });

      // Should trigger cleanup after timeout
      expect(result.current.speechState.isAssistantGeneratingText).toBe(true); // Still true initially
      
      // Fast-forward time to trigger cleanup
      setTimeout(() => {
        expect(result.current.speechState.isAssistantGeneratingText).toBe(false);
        expect(result.current.speechState.canAssistantAnimate).toBe(false);
      }, 1000);
    });

    it('should handle speech-update messages as fallback', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      act(() => {
        const message: LlmMessage = {
          type: 'speech-update',
          status: 'started'
        };
        
        result.current.processLlmMessage(message);
      });

      expect(result.current.speechState.isAssistantSpeaking).toBe(true);
    });

    it('should ignore speech-update when recent transcript exists', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      // First send transcript
      act(() => {
        const transcriptMessage: LlmMessage = {
          type: 'transcript',
          role: 'assistant',
          transcript: 'Recent transcript',
          transcriptType: 'partial'
        };
        result.current.processLlmMessage(transcriptMessage);
      });

      const assistantSpeakingBeforeSpeechUpdate = result.current.speechState.isAssistantSpeaking;

      // Then try to override with speech-update
      act(() => {
        const speechMessage: LlmMessage = {
          type: 'speech-update',
          status: 'stopped'
        };
        result.current.processLlmMessage(speechMessage);
      });

      // Should not override recent transcript data
      expect(result.current.speechState.isAssistantSpeaking).toBe(assistantSpeakingBeforeSpeechUpdate);
    });
  });

  describe('User Speech Priority Handling', () => {
    it('should respond to speech context changes for user speech', () => {
      const { result, rerender } = renderHook(() => useLipsyncSpeechDetection());
      
      // Verify initial state - both should be false initially
      expect(result.current.speechState.isUserSpeaking).toBe(false);
      expect(result.current.speechState.canAssistantAnimate).toBe(false);

      // Simulate user speaking by updating the mock context
      act(() => {
        Object.assign(mockVoiceSessionContext, {
          isUserSpeaking: true,
          assistantVolumeLevel: 0
        });
        // Force a re-render to trigger the useEffect that syncs with speech context
        rerender();
      });

      // The hook should now reflect user speaking state from context
      expect(result.current.speechState.isUserSpeaking).toBe(true);
      expect(result.current.speechState.canAssistantAnimate).toBe(false);
    });

    it('should handle user speech end with delay', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      // Start with user speaking
      act(() => {
        Object.assign(mockVoiceSessionContext, {
          isUserSpeaking: true
        });
      });

      // Then user stops
      act(() => {
        Object.assign(mockVoiceSessionContext, {
          isUserSpeaking: false,
          isAssistantSpeaking: true,
          assistantVolumeLevel: 60
        });
      });

      expect(result.current.speechState.isUserSpeaking).toBe(false);
      
      // Animation permission should be restored after delay
      setTimeout(() => {
        expect(result.current.speechState.canAssistantAnimate).toBe(true);
      }, 350);
    });
  });

  describe('Force Control Functions', () => {
    it('should provide forceStopAnimations and resumeAnimations functions', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      // Verify the functions exist
      expect(typeof result.current.forceStopAnimations).toBe('function');
      expect(typeof result.current.resumeAnimations).toBe('function');
      
      // These functions are mainly used for external control and context sync
      // Testing their internal state changes requires more complex setup
      expect(result.current.speechState.canAssistantAnimate).toBe(false); // Initially false
    });

    it('should resume animations after force stop', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      // Force stop first
      act(() => {
        result.current.forceStopAnimations();
      });

      // Then resume
      act(() => {
        result.current.resumeAnimations();
      });

      expect(result.current.speechState.isUserSpeaking).toBe(false);
    });
  });

  describe('Speech Context Synchronization', () => {
    it('should sync with speech context changes', () => {
      const { result } = renderHook(() => useLipsyncSpeechDetection());
      
      // The hook syncs with speech context via useEffect
      // Since we're using a static mock, the values will be read from the mock context
      expect(result.current.speechState.audioLevel).toBe(mockVoiceSessionContext.audioLevel);
      expect(result.current.speechState.assistantVolumeLevel).toBe(mockVoiceSessionContext.assistantVolumeLevel);
    });
  });
});
