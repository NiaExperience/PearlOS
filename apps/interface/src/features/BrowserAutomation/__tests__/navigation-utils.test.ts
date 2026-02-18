import { parseNavigationRequest } from '../lib/navigation-utils';

describe('parseNavigationRequest', () => {
  it('maps direct site names with intent phrases', () => {
    expect(parseNavigationRequest('open cnn')).toBe('https://cnn.com');
    expect(parseNavigationRequest('go to bbc')).toBe('https://bbc.com');
    expect(parseNavigationRequest('visit hacker news')).toBe('https://news.ycombinator.com');
  });

  it('handles fuzzy contains', () => {
    expect(parseNavigationRequest('latest on reddit communities')).toBe('https://reddit.com');
  });

  it('treats bare domains as navigable', () => {
    expect(parseNavigationRequest('example.com')).toBe('https://example.com');
  });

  it('defaults to search for multi-word non-mapped phrases', () => {
    const input = 'weather in paris';
    const out = parseNavigationRequest(input);
    expect(out.startsWith('https://www.google.com/search?q=')).toBe(true);
    expect(decodeURIComponent(out.split('=')[1])).toBe(input);
  });

  it('lowercases and trims input safely', () => {
    expect(parseNavigationRequest('   Open   GITHUB   ')).toBe('https://github.com');
  });
});

describe('parseNavigationRequest edge cases', () => {
  it('navigates for phrase with site name and non-guard word ("latest on cnn")', () => {
    expect(parseNavigationRequest('latest on cnn')).toBe('https://cnn.com');
  });

  it('falls back to search when contextual location word appears with embedded site name ("news on bbc in london")', () => {
    const input = 'news on bbc in london';
    const out = parseNavigationRequest(input);
    expect(out.startsWith('https://www.google.com/search?q=')).toBe(true);
    expect(decodeURIComponent(out.split('=')[1])).toBe(input);
  });

  it('treats weather near me as search (contextual)', () => {
    const input = 'weather near me';
    const out = parseNavigationRequest(input);
    expect(out.startsWith('https://www.google.com/search?q=')).toBe(true);
  });

  it('handles direct phrase with extra trailing context still navigating ("open hacker news about ai")', () => {
    expect(parseNavigationRequest('open hacker news about ai')).toBe('https://news.ycombinator.com');
  });

  it('returns direct domain for unknown domain-like token', () => {
    expect(parseNavigationRequest('someunknownsite.example')).toBe('https://someunknownsite.example');
  });

  it('returns full URL form for domain with path fragment', () => {
    expect(parseNavigationRequest('cnn.com/latest')).toBe('https://cnn.com/latest');
  });

  it('navigates when phrase starts with site name even with contextual word later ("stack overflow in 2025 survey")', () => {
    expect(parseNavigationRequest('stack overflow in 2025 survey')).toBe('https://stackoverflow.com');
  });

  it('navigates when phrase starts with site name followed by contextual word ("verge in review")', () => {
    expect(parseNavigationRequest('verge in review')).toBe('https://theverge.com');
  });

  it('navigates for direct intent phrase variant ("show me reddit in spanish") despite contextual word', () => {
    expect(parseNavigationRequest('show me reddit in spanish')).toBe('https://reddit.com');
  });
});
