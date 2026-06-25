import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { isTestModeBypassAllowed } from '@interface/lib/api-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const log = getLogger('[api_chat_news_intelligence]');
const OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_API_KEY || '';
const NEWS_MODEL = process.env.PEARLOS_NEWS_INTELLIGENCE_MODEL || 'openrouter/anthropic/claude-sonnet-4.5';

type SearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
  content?: string;
};

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\d+(?:[,\s-]+\d+)*\]/g, '')
    .replace(/\b(?:Skip to Content|Got a tip for us\?|View in English|English US Edition|English UK|Get Started|Explore Get Started Overview|Apple Store Mac iPad iPhone Watch Vision AirPods TV & Home Entertainment Accessories Support)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(value: string, maxLength = 260): string {
  const text = clean(value);
  if (!text) return '';
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  let sentence = sentences[0]?.trim() ?? text;
  if (sentence.length < 45 && sentences[1]) sentence = `${sentence} ${sentences[1].trim()}`;
  if (sentence.length <= maxLength) return sentence;
  return `${sentence.slice(0, maxLength - 1).replace(/\s+\S*$/g, '').replace(/[,\s;:.-]+$/g, '').trim()}...`;
}

function sourceName(item: SearchResult): string {
  const explicit = clean(item.source);
  if (explicit) return explicit;
  try {
    return new URL(String(item.url ?? '')).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function topicFromQuery(query: string): string {
  return clean(query)
    .replace(/^what(?:'| i)?s\s+(?:the\s+)?latest\s+(?:with|on|about)?\s*/i, '')
    .replace(/\b(?:latest|today|current|recent|news|updates?|headlines)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'this story';
}

function unique(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean))).slice(0, limit);
}

function isBoilerplateSentence(sentence: string): boolean {
  const text = clean(sentence);
  if (text.length < 35 || text.length > 280) return true;
  if (/\b(skip to|edition|newsletter|all rights reserved|follow us|share this|got a tip|view in english|get started explore)\b/i.test(text)) return true;
  const words = text.split(/\s+/);
  const capitalized = words.filter((word) => /^[A-Z][A-Za-z0-9'’-]*$/.test(word)).length;
  return words.length > 10 && capitalized / words.length > 0.62;
}

function sourceSentences(results: SearchResult[], documents: SearchResult[]): string[] {
  const text = [...documents, ...results]
    .map((item) => clean(`${item.title ?? ''}. ${item.content ?? item.snippet ?? ''}`))
    .join(' ');
  const sentences = clean(text).match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  return unique(sentences.filter((sentence) => !isBoilerplateSentence(sentence)), 8);
}

function fallbackBrief(query: string, results: SearchResult[], documents: SearchResult[]) {
  const topic = topicFromQuery(query);
  const merged = [...documents, ...results].slice(0, 10);
  const sourceText = merged.map((item) => clean(`${item.title ?? ''}. ${item.content ?? item.snippet ?? ''}`)).join(' ');
  const developments = sourceSentences(results, documents).slice(0, 4);
  const actors = unique(sourceText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) ?? [], 5)
    .filter((name) => !/^(The|This|That|Today|Latest|News|United Kingdom|British|Government)$/.test(name));
  const dataPoints = unique(sourceText.match(/\b\d+(?:\.\d+)?\s?(?:%|percent|points?|seats?|votes?|billion|million|bn|mn|days?|weeks?|months?|years?)\b/gi) ?? [], 4);

  const bottomLine = developments[0] || `The returned sources are clustered around ${topic}.`;
  const secondSignal = developments[1] || `The available source text is thin, so treat this as a provisional read on ${topic}.`;
  const thirdSignal = developments[2] || 'The next useful confirmation should come from primary documents, direct statements, hard numbers, or aligned reporting from another outlet.';

  return {
    headline: `Source-backed snapshot: ${topic}`,
    bottomLine,
    whyItMatters: secondSignal,
    keyDevelopments: developments.length ? developments : [`The returned sources are clustered around ${topic}.`],
    stakes: [
      actors.length ? `Named actors in the returned material: ${actors.slice(0, 4).join(', ')}.` : 'Named actors: the available source set did not surface a clean actor list.',
      dataPoints.length ? `Data points in the returned material: ${dataPoints.slice(0, 4).join(', ')}.` : 'Data points: the available source set did not surface a clean numeric anchor yet.',
      `Confirmation needed: ${thirdSignal}`,
    ],
    tensions: [
      { label: 'Source quality', text: 'This is a local fallback built from returned snippets and fetched excerpts because model synthesis was unavailable.' },
      { label: 'Uncertainty', text: 'Treat the brief as provisional until cleaner primary or specialist sources confirm the same pattern.' },
    ],
    watchNext: [
      'Check primary-source documents or direct statements tied to the same claim.',
      'Compare later reporting against the same named actors, dates, and figures.',
      'Watch whether independent sources repeat the same core facts or contradict them.',
    ],
    sourceNames: [],
  };
}

function extractJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || content;
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('no_json_object');
  return JSON.parse(raw.slice(first, last + 1));
}

function buildPrompt(query: string, results: SearchResult[], documents: SearchResult[]): string {
  const packedSources = [...documents, ...results].slice(0, 10).map((item, index) => ({
    id: index + 1,
    title: clean(item.title).slice(0, 180),
    source: sourceName(item),
    url: clean(item.url).slice(0, 300),
    text: clean(item.content || item.snippet).slice(0, 2600),
  }));

  return `You are Pearl's news intelligence desk. The user asked: "${query}"

Turn the explored sources into a concise intelligence brief for a normal person who wants the real story, not search results.

Rules:
- Do not mention searching, tool calls, "sources found", links, source names, or process.
- Do not list headlines. Synthesize what the reporting means.
- Prefer concrete actors, stakes, dates, numbers, incentives, and what changed.
- If sources conflict or are thin, say the uncertainty plainly in the tensions/watch-next fields.
- Keep each sentence punchy and conversational.
- Return valid JSON only. No markdown.

Schema:
{
  "brief": {
    "headline": "specific insight headline, not a generic topic",
    "bottomLine": "one direct paragraph with the central read",
    "whyItMatters": "one paragraph explaining the stakes and power dynamics",
    "keyDevelopments": ["3-5 synthesized developments"],
    "stakes": ["3-5 concrete stakes, with actors or data where available"],
    "watchNext": ["2-4 specific signals to monitor"],
    "tensions": [{"label":"short label","text":"specific uncertainty or opposing force"}],
    "sourceNames": []
  }
}

Sources:
${JSON.stringify(packedSources, null, 2)}`;
}

async function synthesizeWithModel(query: string, results: SearchResult[], documents: SearchResult[]) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (OPENCLAW_TOKEN) headers.Authorization = `Bearer ${OPENCLAW_TOKEN}`;

  const response = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: NEWS_MODEL,
      messages: [{ role: 'user', content: buildPrompt(query, results, documents) }],
      temperature: 0.25,
      max_tokens: 1600,
    }),
    signal: AbortSignal.timeout(35000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`openclaw_${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = String(data.choices?.[0]?.message?.content || '');
  return extractJsonObject(content);
}

export async function POST(req: NextRequest) {
  const testMode = isTestModeBypassAllowed();
  const session = await getSessionSafely(req, interfaceAuthOptions);
  if (!testMode && !session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { query?: string; results?: SearchResult[]; documents?: SearchResult[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const query = clean(body.query);
  const results = Array.isArray(body.results) ? body.results : [];
  const documents = Array.isArray(body.documents) ? body.documents : [];
  const merged = [...documents, ...results].slice(0, 10);

  if (!query || merged.length === 0) {
    return NextResponse.json({ error: 'query_and_sources_required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await synthesizeWithModel(query, results, documents));
  } catch (error) {
    log.warn('Falling back to local news brief synthesis', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ brief: fallbackBrief(query, results, documents), fallback: true });
  }
}
