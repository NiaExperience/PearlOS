export type QuickSite = {
  name: string;
  patterns: string[]; // names/aliases to match
  url: string; // canonical https URL
};

export const QUICK_SITES: QuickSite[] = [
  { name: 'CNN', patterns: ['cnn', 'cnn.com'], url: 'https://www.cnn.com' },
  { name: 'Reddit', patterns: ['reddit', 'reddit.com'], url: 'https://www.reddit.com' },
  { name: 'Wired', patterns: ['wired', 'wired.com'], url: 'https://www.wired.com' },
  { name: 'New York Times', patterns: ['nytimes', 'nyt', 'nytimes.com'], url: 'https://www.nytimes.com' },
  { name: 'BBC', patterns: ['bbc', 'bbc.com'], url: 'https://www.bbc.com' },
  { name: 'TechCrunch', patterns: ['techcrunch', 'techcrunch.com'], url: 'https://techcrunch.com' },
  { name: 'The Verge', patterns: ['verge', 'theverge', 'theverge.com'], url: 'https://www.theverge.com' },
  { name: 'Bloomberg', patterns: ['bloomberg', 'bloomberg.com'], url: 'https://www.bloomberg.com' },
  { name: 'Reuters', patterns: ['reuters', 'reuters.com'], url: 'https://www.reuters.com' },
  { name: 'WSJ', patterns: ['wsj', 'wall street journal', 'wsj.com'], url: 'https://www.wsj.com' },
  { name: 'Hacker News', patterns: ['hn', 'hacker news', 'news.ycombinator.com'], url: 'https://news.ycombinator.com' },
  { name: 'Ars Technica', patterns: ['ars', 'ars technica', 'arstechnica.com'], url: 'https://arstechnica.com' }
];

export function resolveQuickSite(input: string | undefined | null): string | null {
  const q = (input || '').trim().toLowerCase();
  if (!q) return null;
  for (const site of QUICK_SITES) {
    for (const pat of site.patterns) {
      if (q === pat.toLowerCase()) return site.url;
    }
  }
  return null;
}


