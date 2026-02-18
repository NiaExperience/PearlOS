/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import '@testing-library/jest-dom';

import AssistantPersonalityVoiceTab from '../src/components/assistant-personality-voice-tab';

// Minimal Assistant type stub
type MinimalAssistant = {
  _id: string;
  tenantId: string;
  name: string;
  supportedFeatures: unknown[];
  model: { provider: string; model: string };
  voice?: { provider: string; voiceId: string };
};

const selectedAssistant: MinimalAssistant = {
  _id: 'a1',
  tenantId: 't1',
  name: 'Test Assistant',
  supportedFeatures: [],
  model: { provider: 'openai', model: 'gpt-4' },
  voice: { provider: 'elevenlabs', voiceId: 'voice-default' }
};

// Mock fetch for personalities APIs
const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function TestHarness({ assistant, defaultValues }: { assistant: MinimalAssistant, defaultValues: any }) {
  const methods = useForm({ defaultValues });
  return (
    <FormProvider {...methods}>
      <AssistantPersonalityVoiceTab selectedAssistant={assistant} form={methods} />
    </FormProvider>
  );
}

describe('AssistantPersonalityVoiceTab Mode Configuration', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Default mock for personalities
    fetchMock.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.startsWith('/api/personalities?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [ 
            { _id: 'p-default', name: 'Default Personality' },
            { _id: 'p-work', name: 'Work Personality' }
          ] }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
  });

  it('uses assistant default personality and voice when mode config is missing', async () => {
    const defaultValues = {
      modePersonalityVoiceConfig: {
        default: {
          personalityId: 'p-default',
          voice: {
            provider: 'elevenlabs',
            voiceId: 'voice-default'
          }
        }
      }
    };

    render(<TestHarness assistant={selectedAssistant} defaultValues={defaultValues} />);

    // Wait for personalities to load and render
    await screen.findAllByText('Default Personality');

    // Check 'home' mode row (should fallback to default)
    await waitFor(() => {
      const homeCell = screen.getByText('home');
      const homeRow = homeCell.closest('tr');
      expect(homeRow).toHaveTextContent('Default Personality');
      expect(homeRow).toHaveTextContent('elevenlabs');
      expect(homeRow).toHaveTextContent('voice-default');
    });

    // Check 'work' mode row (should also fallback)
    const workCell = screen.getByText('work');
    const workRow = workCell.closest('tr');
    expect(workRow).toHaveTextContent('Default Personality');
  });

  it('uses specific mode configuration when available', async () => {
    const defaultValues = {
      modePersonalityVoiceConfig: {
        default: {
          personalityId: 'p-default',
          voice: {
            provider: 'elevenlabs',
            voiceId: 'voice-default'
          }
        },
        work: {
          personalityId: 'p-work',
          voice: {
            provider: 'openai',
            voiceId: 'voice-work'
          }
        }
      }
    };

    render(<TestHarness assistant={selectedAssistant} defaultValues={defaultValues} />);

    // Wait for personalities to load and render
    await screen.findByText('Work Personality');

    // Check 'work' mode row (should use override)
    const workCell = screen.getByText('work');
    const workRow = workCell.closest('tr');
    expect(workRow).toHaveTextContent('Work Personality');
    expect(workRow).toHaveTextContent('openai');
    expect(workRow).toHaveTextContent('voice-work');

    // Check 'home' mode row (should still fallback)
    const homeCell = screen.getByText('home');
    const homeRow = homeCell.closest('tr');
    expect(homeRow).toHaveTextContent('Default Personality');
    expect(homeRow).toHaveTextContent('voice-default');
  });
});
