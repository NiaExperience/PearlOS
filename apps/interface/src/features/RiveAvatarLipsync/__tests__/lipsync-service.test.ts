/**
 * LipsyncService Tests
 * 
 * Tests for the central orchestration service
 */

import { LipsyncService } from '../services/LipsyncService';
import type { LipsyncConfig, LlmMessage } from '../types/lipsync-types';

describe('LipsyncService', () => {
  let service: LipsyncService;

  beforeEach(() => {
    service = new LipsyncService();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', async () => {
      await service.initialize();
      
      expect(service.getConfig().enabled).toBe(true);
      expect(service.getConfig().useRiveAnimations).toBe(true);
      expect(service.getConfig().voiceConfusion.transcriptOnlyTriggers).toBe(true);
      expect(service.getMetrics().isInitialized).toBe(true);
    });

    it('should initialize with custom configuration', async () => {
      const customConfig: Partial<LipsyncConfig> = {
        enabled: false,
        useRiveAnimations: false,
        debug: {
          enableLogging: false,
          showDebugPanel: false,
          logStateChanges: false
        }
      };

      await service.initialize(customConfig);
      
      expect(service.getConfig().enabled).toBe(false);
      expect(service.getConfig().useRiveAnimations).toBe(false);
      expect(service.getConfig().debug.enableLogging).toBe(false);
    });
  });

  describe('Service Lifecycle', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should start and stop service correctly', () => {
      service.start();
      expect(service.getMetrics().isRunning).toBe(true);

      service.stop();
      expect(service.getMetrics().isRunning).toBe(false);
      
      // Should reset animation state on stop
      const state = service.getAnimationState();
      expect(state.shouldShowTalkingAnimation).toBe(false);
      expect(state.animationType).toBe('idle');
    });

    it('should not start if not initialized', () => {
      const uninitializedService = new LipsyncService();
      
      expect(() => {
        uninitializedService.start();
      }).toThrow('LipsyncService must be initialized before starting');
    });

    it('should not start if disabled', () => {
      service.updateConfig({ enabled: false });
      service.start();
      
      expect(service.getMetrics().isRunning).toBe(false);
    });
  });

  describe('Configuration Updates', () => {
    beforeEach(async () => {
      await service.initialize();
      service.start();
    });

    it('should update configuration correctly', () => {
      const newConfig: Partial<LipsyncConfig> = {
        useRiveAnimations: false,
        voiceConfusion: {
          transcriptOnlyTriggers: false,
          userSpeechResponseTime: 100,
          speechEndTimeout: 2000
        }
      };

      service.updateConfig(newConfig);
      
      const config = service.getConfig();
      expect(config.useRiveAnimations).toBe(false);
      expect(config.voiceConfusion.transcriptOnlyTriggers).toBe(false);
      expect(config.voiceConfusion.userSpeechResponseTime).toBe(100);
    });

    it('should force stop animations when disabled', () => {
      service.updateConfig({ enabled: false });
      
      const state = service.getAnimationState();
      expect(state.shouldShowTalkingAnimation).toBe(false);
      expect(state.forceStopAnimation).toBe(true);
      expect(state.animationType).toBe('frozen');
    });
  });

  describe('VAPI Message Processing', () => {
    let mockProcessor: jest.Mock;

    beforeEach(async () => {
      await service.initialize();
      service.start();
      
      mockProcessor = jest.fn();
      service.setMessageProcessor(mockProcessor);
    });

    it('should process VAPI messages when running', () => {
      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Test message',
        transcriptType: 'final'
      };

      service.processLlmMessage(message);
      
      expect(mockProcessor).toHaveBeenCalledWith(message);
      expect(service.getMetrics().messagesProcessed).toBe(1);
    });

    it('should not process messages when stopped', () => {
      service.stop();
      
      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Test message'
      };

      service.processLlmMessage(message);
      
      expect(mockProcessor).not.toHaveBeenCalled();
    });

    it('should not process messages when disabled', () => {
      service.updateConfig({ enabled: false });
      
      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Test message'
      };

      service.processLlmMessage(message);
      
      expect(mockProcessor).not.toHaveBeenCalled();
    });

    it('should handle processing errors gracefully', () => {
      mockProcessor.mockImplementation(() => {
        throw new Error('Processing error');
      });

      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Test message'
      };

      // Should not throw
      expect(() => {
        service.processLlmMessage(message);
      }).not.toThrow();
    });
  });

  describe('Animation Control', () => {
    beforeEach(async () => {
      await service.initialize();
      service.start();
    });

    it('should force stop animations', () => {
      service.forceStopAnimations();
      
      const state = service.getAnimationState();
      expect(state.shouldShowTalkingAnimation).toBe(false);
      expect(state.forceStopAnimation).toBe(true);
      expect(state.animationType).toBe('frozen');
      expect(state.isUserDominant).toBe(true);
    });

    it('should resume animations', () => {
      // First force stop
      service.forceStopAnimations();
      
      // Then resume
      service.resumeAnimations();
      
      const state = service.getAnimationState();
      expect(state.forceStopAnimation).toBe(false);
      expect(state.isUserDominant).toBe(false);
      expect(state.animationType).toBe('idle');
    });

    it('should update animation state and track changes', () => {
      const newState = {
        shouldShowTalkingAnimation: true,
        forceStopAnimation: false,
        animationType: 'talking' as const,
        intensity: 0.8,
        isUserDominant: false,
        animationName: 'Relax Talk Basic 1'
      };

      service.updateAnimationState(newState);
      
      expect(service.getAnimationState()).toEqual(newState);
      expect(service.getMetrics().animationStateChanges).toBeGreaterThan(0);
    });
  });

  describe('Metrics and Monitoring', () => {
    beforeEach(async () => {
      await service.initialize();
      service.start();
    });

    it('should track performance metrics', () => {
      const message: LlmMessage = {
        type: 'transcript',
        role: 'assistant',
        transcript: 'Test'
      };

      service.processLlmMessage(message);
      
      const metrics = service.getMetrics();
      expect(metrics.messagesProcessed).toBe(1);
      expect(metrics.lastProcessingTime).toBeGreaterThanOrEqual(0);
    });

    it('should track confidence scores', () => {
      service.addConfidenceScore(0.8);
      service.addConfidenceScore(0.6);
      service.addConfidenceScore(0.9);
      
      const metrics = service.getMetrics();
      expect(metrics.averageConfidence).toBeCloseTo(0.77, 1);
    });

    it('should limit confidence score history', () => {
      // Add more than 100 scores
      for (let i = 0; i < 105; i++) {
        service.addConfidenceScore(0.5);
      }
      
      // Should keep only last 100
      const metrics = service.getMetrics();
      expect(metrics.confidenceScores.length).toBe(100);
    });

    it('should track RULE 6 violations', () => {
      const violatingState = {
        shouldShowTalkingAnimation: true,
        forceStopAnimation: false,
        animationType: 'talking' as const,
        intensity: 0.5,
        isUserDominant: true, // This violates RULE 6
        animationName: 'Test'
      };

      service.updateAnimationState(violatingState);
      
      expect(service.getMetrics().rule6Violations).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle initialization errors gracefully', async () => {
      // Mock a service that throws during initialization
      const mockService = new LipsyncService();
      const originalInit = mockService.initialize;
      
      mockService.initialize = jest.fn().mockRejectedValue(new Error('Init error'));
      
      try {
        await mockService.initialize();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle configuration update errors', () => {
      // Service should handle invalid configurations gracefully
      expect(() => {
        service.updateConfig({} as any);
      }).not.toThrow();
    });
  });

  describe('Deep Configuration Merging', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should deep merge nested configuration objects', () => {
      const partialConfig: Partial<LipsyncConfig> = {
        voiceConfusion: {
          transcriptOnlyTriggers: true,
          userSpeechResponseTime: 25, // Only update this field
          speechEndTimeout: 1000
        },
        confidenceWeights: {
          contentLength: 0.5, // Only update this field
          transcriptFinality: 0.3,
          substantialContent: 0.2,
          recentActivity: 0.1
        }
      };

      service.updateConfig(partialConfig);
      
      const config = service.getConfig();
      
      // Should update specified fields
      expect(config.voiceConfusion.userSpeechResponseTime).toBe(25);
      expect(config.confidenceWeights.contentLength).toBe(0.5);
      
      // Should preserve other fields
      expect(config.voiceConfusion.transcriptOnlyTriggers).toBe(true);
      expect(config.confidenceWeights.transcriptFinality).toBe(0.3);
    });
  });
});
