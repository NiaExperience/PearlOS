/**
 * @jest-environment jsdom
 */
import { resolveQuickSite, QUICK_SITES } from '../src/features/MiniBrowser/lib/quick-sites';

describe('resolveQuickSite', () => {
  it('resolves common aliases to canonical URLs', () => {
    expect(resolveQuickSite('cnn')).toBe('https://www.cnn.com');
    expect(resolveQuickSite('cnn.com')).toBe('https://www.cnn.com');
    expect(resolveQuickSite('reddit')).toBe('https://www.reddit.com');
    expect(resolveQuickSite('wired')).toBe('https://www.wired.com');
    expect(resolveQuickSite('nytimes')).toBe('https://www.nytimes.com');
    expect(resolveQuickSite('theverge')).toBe('https://www.theverge.com');
    expect(resolveQuickSite('hn')).toBe('https://news.ycombinator.com');
  });

  it('returns null for unknown inputs', () => {
    expect(resolveQuickSite('someunknownsite')).toBeNull();
    expect(resolveQuickSite('')).toBeNull();
    expect(resolveQuickSite(undefined)).toBeNull();
  });

  it('has a non-empty quick site list', () => {
    expect(Array.isArray(QUICK_SITES)).toBe(true);
    expect(QUICK_SITES.length).toBeGreaterThan(5);
  });
});


