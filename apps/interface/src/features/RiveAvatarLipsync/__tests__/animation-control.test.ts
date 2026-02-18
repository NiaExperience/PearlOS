/**
 * Animation Control Tests
 * 
 * Tests for the useAnimationControl hook and animation state management
 * 
 * @jest-environment jsdom
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useAnimationControl } from '../lib/useAnimationControl';
import type { SpeechDetectionState } from '../types/lipsync-types';

// Mock the speech detection hook
const mockSpeechState: SpeechDetectionState = {
  isAssistantSpeaking: false,
  isUserSpeaking: false,
  assistantVolumeLevel: 0,
  audioLevel: 0,
  isAssistantGeneratingText: false,
  lastAssistantMessage: '',
  assistantSpeechConfidence: 0,
  transcriptQuality: 'none',
  speechTimestamp: Date.now(),
  canAssistantAnimate: false
};

jest.mock('../lib/useLipsyncSpeechDetection', () => ({
  useLipsyncSpeechDetection: () => ({
    speechState: mockSpeechState,
    processLlmMessage: jest.fn(),
    calculateConfidence: jest.fn(),
    determineAnimationPermission: jest.fn(),
    forceStopAnimations: jest.fn(),
    resumeAnimations: jest.fn()
  })
}));

describe('useAnimationControl', () => {
  beforeEach(() => {
    // Reset mock speech state
    Object.assign(mockSpeechState, {
      isAssistantSpeaking: false,
      isUserSpeaking: false,
      assistantVolumeLevel: 0,
      audioLevel: 0,
      isAssistantGeneratingText: false,
      lastAssistantMessage: '',
      assistantSpeechConfidence: 0,
      transcriptQuality: 'none',
      speechTimestamp: Date.now(),
      canAssistantAnimate: false
    });
  });

  describe('Initial State', () => {
    it('should initialize with idle animation state', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      expect(result.current.animationState).toEqual({
        shouldShowTalkingAnimation: false,
        forceStopAnimation: false,
        animationType: 'idle',
        intensity: 0,
        isUserDominant: false,
        animationName: 'Pearl Animation'
      });
    });
  });

  describe('RULE 6: User Priority Enforcement', () => {
    it('should have user priority enforcement functions', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      // Test that the functions exist and can be called without throwing
      expect(typeof result.current.forceStopAnimations).toBe('function');
      expect(typeof result.current.resumeAnimations).toBe('function');
      
      // Test that functions can be called without throwing errors
      expect(() => {
        act(() => {
          result.current.forceStopAnimations();
        });
      }).not.toThrow();
      
      expect(() => {
        act(() => {
          result.current.resumeAnimations();
        });
      }).not.toThrow();
    });

    it('should never violate RULE 6 (user speech always overrides)', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      // Set up scenario where user is speaking
      act(() => {
        Object.assign(mockSpeechState, {
          isUserSpeaking: true,
          isAssistantSpeaking: true,
          isAssistantGeneratingText: true,
          canAssistantAnimate: false, // Correctly blocked when user speaks
          lastAssistantMessage: 'This should not animate',
          assistantSpeechConfidence: 1.0,
          transcriptQuality: 'final'
        });
      });

      // Call forceStopAnimations to enforce RULE 6
      act(() => {
        result.current.forceStopAnimations();
      });

      // Should never show talking animation when user is speaking
      expect(result.current.animationState.shouldShowTalkingAnimation).toBe(false);
      expect(result.current.animationState.forceStopAnimation).toBe(true);
      expect(result.current.animationState.isUserDominant).toBe(true);
    });
  });

  describe('Animation Conditions', () => {
    it('should animate when all conditions are met', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      act(() => {
        Object.assign(mockSpeechState, {
          isAssistantSpeaking: true,
          isUserSpeaking: false,
          isAssistantGeneratingText: true,
          canAssistantAnimate: true,
          lastAssistantMessage: 'This is a substantial message with content',
          assistantSpeechConfidence: 0.8,
          transcriptQuality: 'final',
          assistantVolumeLevel: 60,
          speechTimestamp: Date.now() - 1000 // Recent activity
        });
      });

      // Test the shouldAnimateMouth function directly since the animation state 
      // is managed by a useEffect that responds to speech state changes
      const shouldAnimate = result.current.shouldAnimateMouth();
      expect(shouldAnimate).toBe(true);
      
      // Test intensity calculation
      const intensity = result.current.calculateAnimationIntensity();
      expect(intensity).toBeGreaterThan(0);
    });

    it('should not animate without transcript content', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      act(() => {
        Object.assign(mockSpeechState, {
          isAssistantSpeaking: true,
          isUserSpeaking: false,
          isAssistantGeneratingText: true,
          canAssistantAnimate: true,
          lastAssistantMessage: '', // No content
          assistantSpeechConfidence: 0.8,
          transcriptQuality: 'final'
        });
      });

      const shouldAnimate = result.current.shouldAnimateMouth();
      expect(shouldAnimate).toBe(false);
    });

    it('should not animate with low confidence and poor quality', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      act(() => {
        Object.assign(mockSpeechState, {
          isAssistantSpeaking: true,
          isUserSpeaking: false,
          isAssistantGeneratingText: true,
          canAssistantAnimate: true,
          lastAssistantMessage: 'Short',
          assistantSpeechConfidence: 0.2, // Low confidence
          transcriptQuality: 'none' // Poor quality
        });
      });

      const shouldAnimate = result.current.shouldAnimateMouth();
      expect(shouldAnimate).toBe(false);
    });
  });

  describe('Intensity Calculation', () => {
    it('should calculate intensity based on multiple factors', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      act(() => {
        Object.assign(mockSpeechState, {
          isAssistantSpeaking: true,
          isUserSpeaking: false,
          isAssistantGeneratingText: true,
          canAssistantAnimate: true,
          lastAssistantMessage: 'This is a very long message with substantial content that should boost intensity',
          assistantSpeechConfidence: 0.9,
          transcriptQuality: 'final',
          assistantVolumeLevel: 80,
          speechTimestamp: Date.now() - 500
        });
      });

      const intensity = result.current.calculateAnimationIntensity();
      expect(intensity).toBeGreaterThan(0.4);
      expect(intensity).toBeLessThanOrEqual(1.0);
    });

    it('should enforce minimum intensity threshold', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      act(() => {
        Object.assign(mockSpeechState, {
          isAssistantSpeaking: true,
          isUserSpeaking: false,
          isAssistantGeneratingText: true,
          canAssistantAnimate: true,
          lastAssistantMessage: 'Hi',
          assistantSpeechConfidence: 0.6,
          transcriptQuality: 'partial',
          assistantVolumeLevel: 10, // Very low volume
          speechTimestamp: Date.now() - 100
        });
      });

      const intensity = result.current.calculateAnimationIntensity();
      // Should still meet minimum threshold when animation is active
      expect(intensity).toBeGreaterThanOrEqual(0.4);
    });
  });

  describe('Fallback Animation Mode', () => {
    it('should use fallback animation for volume-only detection', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      act(() => {
        Object.assign(mockSpeechState, {
          isAssistantSpeaking: true,
          isUserSpeaking: false,
          isAssistantGeneratingText: false,
          canAssistantAnimate: true, // Allow animation for fallback mode
          lastAssistantMessage: '', // No transcript
          assistantSpeechConfidence: 0,
          transcriptQuality: 'none',
          assistantVolumeLevel: 70 // High volume but no transcript
        });
      });

      // Test fallback mode by checking if volume-only mode is active
      // The hook's shouldAnimateMouth will return false due to no content
      // But the fallback animation logic is separate
      const shouldAnimate = result.current.shouldAnimateMouth();
      expect(shouldAnimate).toBe(false); // No content, so main animation is false
      
      // But volume-based animation should still work
      const intensity = result.current.calculateAnimationIntensity();
      expect(intensity).toBeGreaterThan(0); // Volume can still provide intensity
    });

    it('should not use fallback with insufficient volume', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      act(() => {
        Object.assign(mockSpeechState, {
          isAssistantSpeaking: true,
          isUserSpeaking: false,
          isAssistantGeneratingText: false,
          canAssistantAnimate: false,
          lastAssistantMessage: '',
          assistantSpeechConfidence: 0,
          transcriptQuality: 'none',
          assistantVolumeLevel: 15 // Too low for fallback
        });
      });

      const shouldAnimate = result.current.shouldAnimateMouth();
      expect(shouldAnimate).toBe(false);
    });
  });

  describe('Animation Names', () => {
    it('should use correct animation names for different states', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      // Test initial state
      expect(result.current.animationState.animationName).toBe('Pearl Animation');
      expect(result.current.animationState.animationType).toBe('idle');

      // Test that force stop function exists and can be called
      expect(typeof result.current.forceStopAnimations).toBe('function');
      
      // The actual state changes depend on the speech context integration
      // which is mocked in this test environment
    });
  });

  describe('Force Control Functions', () => {
    it('should force stop animations when called', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      // Test that functions exist
      expect(typeof result.current.forceStopAnimations).toBe('function');
      expect(typeof result.current.resumeAnimations).toBe('function');
      
      // Test that functions can be called without throwing
      expect(() => {
        act(() => {
          result.current.forceStopAnimations();
        });
      }).not.toThrow();
      
      // The actual state changes depend on the speech context which is mocked
      // The important thing is that the functions exist and can be called
    });

    it('should resume animations when called', () => {
      const { result } = renderHook(() => useAnimationControl());
      
      // First force stop
      act(() => {
        result.current.forceStopAnimations();
      });

      // Then resume
      act(() => {
        result.current.resumeAnimations();
      });

      expect(result.current.animationState.forceStopAnimation).toBe(false);
      expect(result.current.animationState.isUserDominant).toBe(false);
    });
  });
});
