/**
 * @jest-environment node
 */
import { parseNavigationRequest } from '../lib/navigation-utils';

/**
 * Table-driven natural language navigation matrix
 * Ensures phrase → URL intent stays stable (navigate vs search fallback)
 */

type Scenario = {
  phrase: string;
  expectType: 'navigate' | 'search';
  expectUrl?: string;            // full expected URL (when deterministic)
  expectHostContains?: string;   // partial host expectation for navigate
  note?: string;
};

function classify(url: string): 'navigate' | 'search' {
  return url.startsWith('https://www.google.com/search?q=') ? 'search' : 'navigate';
}

const scenarios: Scenario[] = [
  { phrase: 'open cnn', expectType: 'navigate', expectHostContains: 'cnn.com' },
  { phrase: 'go to bbc', expectType: 'navigate', expectHostContains: 'bbc.com' },
  { phrase: 'visit hacker news', expectType: 'navigate', expectHostContains: 'news.ycombinator.com' },
  { phrase: 'latest on reddit communities', expectType: 'navigate', expectHostContains: 'reddit.com', note: 'fuzzy contains' },
  { phrase: 'weather in paris', expectType: 'search' },
  { phrase: 'weather near me', expectType: 'search' },
  { phrase: 'cnn.com/latest', expectType: 'navigate', expectUrl: 'https://cnn.com/latest' },
  { phrase: 'example.com', expectType: 'navigate', expectUrl: 'https://example.com' },
  { phrase: 'someunknownsite.example', expectType: 'navigate', expectUrl: 'https://someunknownsite.example' },
  { phrase: 'open hacker news about ai', expectType: 'navigate', expectHostContains: 'news.ycombinator.com' },
  { phrase: 'stack overflow in 2025 survey', expectType: 'navigate', expectHostContains: 'stackoverflow.com' },
  { phrase: 'verge in review', expectType: 'navigate', expectHostContains: 'theverge.com' },
  { phrase: 'show me reddit in spanish', expectType: 'navigate', expectHostContains: 'reddit.com' },
  { phrase: 'news on bbc in london', expectType: 'search', note: 'contextual location forces search' },
  { phrase: 'navigate to amazon', expectType: 'navigate', expectHostContains: 'amazon.com' },
  { phrase: 'load github', expectType: 'navigate', expectHostContains: 'github.com' },
  { phrase: 'open linkedin profile search', expectType: 'navigate', expectHostContains: 'linkedin.com' },
  { phrase: 'duckduckgo privacy settings', expectType: 'navigate', expectHostContains: 'duckduckgo.com' },
  { phrase: 'open weather', expectType: 'navigate', expectHostContains: 'weather.com' },
  { phrase: 'open weather in paris today', expectType: 'search', note: 'context makes it query' },
  { phrase: 'gmail inbox', expectType: 'navigate', expectHostContains: 'gmail.com' },
  { phrase: 'spotify trending', expectType: 'navigate', expectHostContains: 'spotify.com' },
  { phrase: 'tiktok in france', expectType: 'navigate', expectHostContains: 'tiktok.com' },
  { phrase: 'show me wikipedia article on space', expectType: 'navigate', expectHostContains: 'wikipedia.org' },
  { phrase: 'open yahoo finance', expectType: 'navigate', expectHostContains: 'finance.yahoo.com' },
  { phrase: 'open yahoo finance in tokyo', expectType: 'navigate', expectHostContains: 'finance.yahoo.com' },
  { phrase: 'bbc in spanish', expectType: 'navigate', expectHostContains: 'bbc.com', note: 'contextual word but still navigate because starts with site intent' },
];

describe('Browser natural language navigation matrix', () => {
  it.each(scenarios.map(s => [s.phrase, s]))('%s', (_label, scenario) => {
    const url = parseNavigationRequest(scenario.phrase);
    const type = classify(url);
    expect(type).toBe(scenario.expectType);
    if (scenario.expectUrl) {
      expect(url).toBe(scenario.expectUrl);
    }
    if (scenario.expectHostContains) {
      expect(url).toContain(scenario.expectHostContains);
    }
    if (scenario.expectType === 'search') {
      // Ensure original phrase preserved in encoded form
      const q = decodeURIComponent(url.split('q=')[1] || '');
      expect(q).toBe(scenario.phrase);
    }
  });
});
