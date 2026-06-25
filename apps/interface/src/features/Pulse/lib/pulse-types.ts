export type PulseTrend = 'rising' | 'steady' | 'falling';

export interface PulseComment {
  id: string;
  source: string;
  sourceLanguage: string;
  translatedText: string;
  region: string;
  score: number;
  url?: string;
}

export interface PulseTopic {
  id: string;
  rank: number;
  title: string;
  summary: string;
  score: number;
  trend: PulseTrend;
  region: string;
  lat: number;
  lon: number;
  volumeLabel: string;
  sentimentLabel: string;
  languageLabel: string;
  sourceMix: Array<{ source: string; count: number }>;
  highlights: string[];
  comments: PulseComment[];
  sources: Array<{ label: string; url: string }>;
  coverageNote: string;
  updatedAt: string;
}

export interface PulseTopicsResponse {
  ok: boolean;
  generatedAt: string;
  query: string | null;
  window: string;
  targetLanguage: string;
  coverageNote: string;
  sourceCounts: {
    reddit: number;
    hackerNews: number;
    news: number;
  };
  topics: PulseTopic[];
}
