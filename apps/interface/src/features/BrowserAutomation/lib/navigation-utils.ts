// Navigation utility functions extracted from RealBrowserView for unit testing
// Provides natural language to URL parsing logic.

export const siteMap: Record<string, string> = {
  cnn: 'cnn.com',
  bbc: 'bbc.com',
  'fox news': 'foxnews.com',
  reuters: 'reuters.com',
  'ap news': 'apnews.com',
  npr: 'npr.org',
  cbs: 'cbsnews.com',
  nbc: 'nbcnews.com',
  abc: 'abcnews.go.com',
  google: 'google.com',
  bing: 'bing.com',
  yahoo: 'yahoo.com',
  duckduckgo: 'duckduckgo.com',
  facebook: 'facebook.com',
  twitter: 'twitter.com',
  instagram: 'instagram.com',
  linkedin: 'linkedin.com',
  youtube: 'youtube.com',
  tiktok: 'tiktok.com',
  reddit: 'reddit.com',
  github: 'github.com',
  'stack overflow': 'stackoverflow.com',
  'hacker news': 'news.ycombinator.com',
  techcrunch: 'techcrunch.com',
  verge: 'theverge.com',
  wired: 'wired.com',
  amazon: 'amazon.com',
  ebay: 'ebay.com',
  walmart: 'walmart.com',
  target: 'target.com',
  etsy: 'etsy.com',
  wikipedia: 'wikipedia.org',
  dictionary: 'dictionary.com',
  imdb: 'imdb.com',
  netflix: 'netflix.com',
  hulu: 'hulu.com',
  spotify: 'spotify.com',
  twitch: 'twitch.tv',
  bloomberg: 'bloomberg.com',
  cnbc: 'cnbc.com',
  marketwatch: 'marketwatch.com',
  'yahoo finance': 'finance.yahoo.com',
  craigslist: 'craigslist.org',
  zillow: 'zillow.com',
  weather: 'weather.com',
  gmail: 'gmail.com',
  outlook: 'outlook.com'
};

export function parseNavigationRequest(input: string): string {
  const trimmedInput = input.trim().toLowerCase();

  // Treat contextual weather queries (with or without leading verb) as search (e.g., "open weather in paris")
  if (/^(?:open|go to|visit|show me|navigate to|load)?\s*weather\s+(in|near|at)\b/.test(trimmedInput)) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }

  // Special cases: contextual weather queries should be treated as search (legacy direct form e.g., "weather in paris")
  if (/^weather\s+(in|near|at)\b/.test(trimmedInput)) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }

  // Detect explicit domain with path before fuzzy site name capture (e.g., cnn.com/latest)
  if (/^[a-z0-9.-]+\.[a-z]{2,}\/[^\s]+$/i.test(trimmedInput)) {
    return `https://${trimmedInput}`;
  }

  // Prepare site entries sorted by descending length to prefer multi-word names (e.g., "yahoo finance" before "yahoo")
  const siteEntries = Object.entries(siteMap).sort((a, b) => b[0].length - a[0].length);

  // Direct intent phrases
  for (const [siteName, siteUrl] of siteEntries) {
    if (
      trimmedInput === siteName ||
      trimmedInput.includes(`go to ${siteName}`) ||
      trimmedInput.includes(`load ${siteName}`) ||
      trimmedInput.includes(`open ${siteName}`) ||
      trimmedInput.includes(`show me ${siteName}`) ||
      trimmedInput.includes(`navigate to ${siteName}`) ||
      trimmedInput.includes(`visit ${siteName}`)
    ) {
      return `https://${siteUrl}`;
    }
  }

  // Fuzzy contains (site name somewhere in phrase) but guard against contextual queries like "in" / "near" which likely imply a search
  for (const [siteName, siteUrl] of siteEntries) {
    if (trimmedInput.includes(siteName)) {
      if (/\b(in|near|at)\b/.test(trimmedInput) && /\s/.test(trimmedInput) && !trimmedInput.startsWith(siteName)) {
        // treat as search to preserve query context
        return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
      }
      return `https://${siteUrl}`;
    }
  }

  // Direct domain forms
  if (trimmedInput.includes('.') && !trimmedInput.includes(' ')) {
    return `https://${trimmedInput}`;
  }
  if (trimmedInput.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
    return `https://${trimmedInput}`;
  }

  // Fallback: search query
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}
