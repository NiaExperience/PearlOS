import { joinRoom } from '../lib/botClient';

// Mock fetch for testing
global.fetch = jest.fn();

describe('Voice Parameters Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should pass voice parameters in joinRoom request', async () => {
    const mockResponse = {
      pid: 12345,
      room_url: 'https://test.daily.co/test-room',
      personalityId: 'test-id',
      persona: 'Pearl',
      reused: false
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const voiceParameters = {
      speed: 1.2,
      stability: 0.7,
      similarityBoost: 0.8,
      style: 0.3,
      optimizeStreamingLatency: 1,
      maxCallDuration: 600,
      participantLeftTimeout: 15,
      participantAbsentTimeout: 20,
      enableRecording: true,
      enableTranscription: true,
      applyGreenscreen: false,
      language: 'EN-US'
    };

    const expectedVoiceParameters = {
      ...voiceParameters,
      language: 'en-us'
    };

    const result = await joinRoom('https://test.daily.co/test-room', {
      personalityId: 'test-id',
      persona: 'Pearl',
      tenantId: 'test-tenant',
      voice: 'test-voice-id',
      voiceParameters,
      voiceProvider: 'kokoro'
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/bot/join', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_url: 'https://test.daily.co/test-room',
        personalityId: 'test-id',
        persona: 'Pearl',
        tenantId: 'test-tenant',
        call_intent_id: undefined,
        force_new: false,
        voice: 'test-voice-id',
        voiceParameters: expectedVoiceParameters,
        voiceProvider: 'kokoro'
      })
    }));

    expect(result).toEqual(mockResponse);
  });

  it('should handle joinRoom without voice parameters', async () => {
    const mockResponse = {
      pid: 12345,
      room_url: 'https://test.daily.co/test-room',
      personalityId: 'test-id',
      persona: 'Pearl',
      reused: false
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await joinRoom('https://test.daily.co/test-room', {
      personalityId: 'test-id',
      persona: 'Pearl',
      tenantId: 'test-tenant',
      voice: 'test-voice-id'
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/bot/join', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_url: 'https://test.daily.co/test-room',
        personalityId: 'test-id',
        persona: 'Pearl',
        tenantId: 'test-tenant',
        call_intent_id: undefined,
        force_new: false,
        voice: 'test-voice-id',
        voiceParameters: undefined
      })
    }));

    expect(result).toEqual(mockResponse);
  });

  it('should handle partial voice parameters', async () => {
    const mockResponse = {
      pid: 12345,
      room_url: 'https://test.daily.co/test-room',
      personalityId: 'test-id',
      persona: 'Pearl',
      reused: false
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const partialVoiceParameters = {
      speed: 1.5,
      stability: 0.6
    };

    const result = await joinRoom('https://test.daily.co/test-room', {
      personalityId: 'test-id',
      persona: 'Pearl',
      tenantId: 'test-tenant',
      voice: 'test-voice-id',
      voiceParameters: partialVoiceParameters
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/bot/join', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_url: 'https://test.daily.co/test-room',
        personalityId: 'test-id',
        persona: 'Pearl',
        tenantId: 'test-tenant',
        call_intent_id: undefined,
        force_new: false,
        voice: 'test-voice-id',
        voiceParameters: partialVoiceParameters
      })
    }));

    expect(result).toEqual(mockResponse);
  });
});
