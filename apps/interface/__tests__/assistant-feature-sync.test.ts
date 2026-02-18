jest.mock('@nia/features', () => {
  // Preserve FeatureKeys while allowing tests to override isFeatureEnabled
  const actual = jest.requireActual('@nia/features');
  return {
    ...actual,
    isFeatureEnabled: jest.fn(() => true),
  };
});

import { FeatureKeys, isFeatureEnabled } from '@nia/features';

import {
  coerceFeatureKeyList,
  isAssistantSelfCloseNiaEvent,
} from '../src/lib/assistant-feature-sync';

const mockedIsFeatureEnabled = jest.mocked(isFeatureEnabled);

describe('interface assistant feature sync helpers', () => {
  beforeEach(() => {
    mockedIsFeatureEnabled.mockReturnValue(true);
  });

  test('coerceFeatureKeyList filters invalid keys and deduplicates while preserving canonical order', () => {
    const raw = ['notes', 'invalid', 'assistantSelfClose', 'notes', 'miniBrowser'];
    const result = coerceFeatureKeyList(raw);

    const expected = FeatureKeys.filter(key => new Set(raw).has(key));
    expect(result).toEqual(expected);
    expect(result.filter((key: string) => key === 'notes')).toHaveLength(1);
  });

  test('isAssistantSelfCloseNiaEvent detects apps.close for daily call aliases', () => {
    expect(
      isAssistantSelfCloseNiaEvent({
        event: 'apps.close',
        payload: { apps: ['dailyCall'] },
      })
    ).toBe(true);

    expect(
      isAssistantSelfCloseNiaEvent({
        event: 'apps.close',
        payload: { apps: [' meeting '] },
      })
    ).toBe(true);

    expect(
      isAssistantSelfCloseNiaEvent({
        event: 'apps.close',
        payload: { apps: ['notes'] },
      })
    ).toBe(false);
  });

  test('isAssistantSelfCloseNiaEvent detects bot.session.end envelopes', () => {
    expect(isAssistantSelfCloseNiaEvent({ event: 'bot.session.end', payload: {} })).toBe(true);
    expect(isAssistantSelfCloseNiaEvent({ event: 'bot.speaking.started', payload: {} })).toBe(false);
  });
});
