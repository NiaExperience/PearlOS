/**
 * @jest-environment jsdom
 */

import { render, waitFor } from '@testing-library/react';
import React from 'react';

// Don't mock the voice session context - use the real one to respond to events
import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { VoiceSessionProvider } from '@interface/contexts/voice-session-context';

import { DailyCallStateProvider } from '../../DailyCall/state/store';

jest.mock('@interface/features/YouTube/lib/youtube-api', () => ({
  searchYouTube: jest.fn().mockResolvedValue({
    currentVideo: { videoId: 'abc123', title: 'Test Video' },
    videos: [{ videoId: 'abc123', title: 'Test Video' }],
    comments: []
  })
}));

import YouTubeViewWrapper from '../components/YouTubeViewWrapper';
import { computeTargetVolume } from '../components/youtube-view';

const capturedEvents: any[] = [];

// Helper functions to simulate speech events
const simulateUserSpeaking = (isSpeaking: boolean) => {
  window.dispatchEvent(new CustomEvent('daily:userAudioLevel', {
    detail: { level: isSpeaking ? 0.5 : 0, isSpeaking }
  }));
};

const simulateAssistantSpeaking = (isSpeaking: boolean) => {
  window.dispatchEvent(new CustomEvent('daily:audioLevel', {
    detail: { botParticipantId: 'bot-123', level: isSpeaking ? 0.5 : 0, isSpeaking }
  }));
};

beforeAll(() => {
  window.addEventListener('youtube.volume.change', (e: any) => capturedEvents.push(e.detail));
});

describe('YouTube volume modulation', () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    (window as any).YT = {
      Player: function (_id: string, opts: any) {
        const api: any = {
          _vol: 70,
          setVolume(v: number) { api._vol = v; },
          getVolume() { return api._vol; },
          playVideo() {},
          loadVideoById() {},
          destroy() {}
        };
        setTimeout(() => opts.events?.onReady?.({ target: api }), 0);
        return api;
      }
    };
  });

  it('computes lowered volume when user or assistant speaking', () => {
    expect(computeTargetVolume(70, true, false)).toBe(14);
    expect(computeTargetVolume(70, false, true)).toBe(14);
    expect(computeTargetVolume(70, false, false)).toBe(70);
  });

  it('emits initial youtube.volume.change event on player ready', async () => {
    render(React.createElement(DesktopModeProvider, null, React.createElement(DailyCallStateProvider, null, React.createElement(VoiceSessionProvider, null, React.createElement(YouTubeViewWrapper, { query: 'demo' })))));
    await waitFor(() => {
      expect(capturedEvents.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 1000 });
    expect(capturedEvents[0].targetVolume).toBe(70);
  });

  it('lowers then restores volume for user speaking sequence', async () => {
    render(React.createElement(DesktopModeProvider, null, React.createElement(DailyCallStateProvider, null, React.createElement(VoiceSessionProvider, null, React.createElement(YouTubeViewWrapper, { query: 'demo' })))));
    await waitFor(() => expect(capturedEvents.length).toBeGreaterThan(0));
    
    simulateUserSpeaking(true);
    await waitFor(() => expect(capturedEvents.some(e => e.user && e.targetVolume === 14)).toBe(true));
    
    simulateUserSpeaking(false);
    await waitFor(() => expect(capturedEvents.filter(e => !e.user && !e.assistant).some(e => e.targetVolume === 70)).toBe(true));
  });

  it('keeps volume lowered while either party speaking and restores only after both stop', async () => {
    render(React.createElement(DesktopModeProvider, null, React.createElement(DailyCallStateProvider, null, React.createElement(VoiceSessionProvider, null, React.createElement(YouTubeViewWrapper, { query: 'demo' })))));
    await waitFor(() => expect(capturedEvents.length).toBeGreaterThan(0));
    
    // User starts
    simulateUserSpeaking(true);
    await waitFor(() => expect(capturedEvents.some(e => e.user && e.targetVolume === 14)).toBe(true));
    
    // Assistant starts while user still speaking
    simulateAssistantSpeaking(true);
    await waitFor(() => expect(capturedEvents.some(e => e.user && e.assistant && e.targetVolume === 14)).toBe(true));
    
    // User stops (assistant still speaking) -> still low
    simulateUserSpeaking(false);
    await waitFor(() => expect(capturedEvents.some(e => !e.user && e.assistant && e.targetVolume === 14)).toBe(true));
    
    // Assistant stops -> restore
    simulateAssistantSpeaking(false);
    await waitFor(() => expect(capturedEvents.filter(e => !e.user && !e.assistant).some(e => e.targetVolume === 70)).toBe(true));
  });
});
