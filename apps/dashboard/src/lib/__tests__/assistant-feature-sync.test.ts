import { FeatureKeys } from '@nia/features';

import {
  coerceFeatureKeyList,
  featureListsEqual,
} from '../assistant-feature-sync';

describe('assistant-feature-sync helpers', () => {
  test('coerceFeatureKeyList filters invalid keys and deduplicates while preserving canonical order', () => {
    const raw = ['notes', 'invalid', 'assistantSelfClose', 'notes', 'miniBrowser'];
    const result = coerceFeatureKeyList(raw);

    const expected = FeatureKeys.filter(key => new Set(raw).has(key));
    expect(result).toEqual(expected);
    expect(result.filter(key => key === 'notes')).toHaveLength(1);
  });

  test('featureListsEqual performs ordered comparison', () => {
    const first = coerceFeatureKeyList(['notes', 'gmail', 'assistantSelfClose']);
    const sameOrder = [...first];
    const differentOrder = [...first].reverse();

    expect(featureListsEqual(first, sameOrder)).toBe(true);
    expect(featureListsEqual(first, differentOrder)).toBe(false);
  });
});
