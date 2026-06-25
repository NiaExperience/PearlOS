import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { isTestModeBypassAllowed } from '@interface/lib/api-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const log = getLogger('[api_chat_search_answer]');
const OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_API_KEY || '';
const SEARCH_ANSWER_MODEL = process.env.PEARLOS_SEARCH_ANSWER_MODEL
  || process.env.PEARL_COMMENTARY_MODEL
  || process.env.BOT_FAST_MODEL
  || 'deepseek-v4-flash';

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
    .replace(/\[[ivxlcdm]+\]/gi, '')
    .replace(/\b(?:Skip to Content|Got a tip for us\?|View in English|English US Edition|English UK|Get Started|Explore Get Started Overview|Checking your browser before accessing|Checking your browser|Just a moment|Enable JavaScript and cookies to continue|Verifying you are human|Please stand by while we are checking your browser|Cloudflare Ray ID)\b/gi, ' ')
    .replace(/\s+\.\.\./g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(value: string, maxLength = 280): string {
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
    .replace(/\b(?:latest|today|current|recent|news|updates?|headlines|search|look up|find out)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'this';
}

function unique(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean))).slice(0, limit);
}

function isBoilerplateSentence(sentence: string): boolean {
  const text = clean(sentence);
  if (text.length < 35 || text.length > 280) return true;
  if (/\b(skip to|edition|newsletter|all rights reserved|follow us|share this|got a tip|view in english|get started explore|verifying you are human|cloudflare)\b/i.test(text)) return true;
  const words = text.split(/\s+/);
  const capitalized = words.filter((word) => /^[A-Z][A-Za-z0-9'-]*$/.test(word)).length;
  return words.length > 10 && capitalized / words.length > 0.62;
}

function sourceSentences(results: SearchResult[]): string[] {
  const text = results
    .map((item) => clean(item.content || item.snippet))
    .join(' ');
  const sentences = clean(text).match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  return unique(sentences.filter((sentence) => !isBoilerplateSentence(sentence)), 6);
}

function looksLikeRawSearchDump(text: string, results: SearchResult[]): boolean {
  const cleaned = clean(text);
  if (!cleaned) return false;
  if (/\b(?:search results?|sources?\s+sampled|source\s*:|snippet\s*:|url\s*:|result\s+\d+\s*:)\b/i.test(cleaned)) return true;
  if (/https?:\/\//i.test(cleaned)) return true;
  const lower = cleaned.toLowerCase();
  if (results.some((item) => {
    const title = clean(item.title);
    return title.length >= 12 && lower.includes(`${title.toLowerCase()}:`);
  })) return true;
  const colonSegments = cleaned.match(/\b[A-Z][^.!?\n]{8,90}:\s[^.!?\n]{18,}/g) || [];
  return colonSegments.length >= 2;
}

function fallbackAnswer(query: string, results: SearchResult[]) {
  const topic = topicFromQuery(query);
  const signals = sourceSentences(results);
  const fallbackSignals = signals.length
    ? signals
    : results.map((item) => firstSentence(item.snippet || item.title || '')).filter(Boolean).slice(0, 4);
  const uniqueSignals = unique(fallbackSignals, 4);

  if (!uniqueSignals.length) {
    return {
      answer: `I could not get enough clean page text to answer ${topic} without guessing.`,
      fallback: true,
    };
  }

  const normalizedQuestion = clean(query).toLowerCase();
  const evidence = clean(uniqueSignals.join(' ')).toLowerCase();
  let lead = 'The cleanest answer is:';
  if (/\b(?:is|are|can|could|does|do|did|has|have|is there|any way)\b/.test(normalizedQuestion)) {
    if (/\b(?:not available|not generally available|not supported|cannot|can't|no way|must be a player|needs a player|requires a player)\b/.test(evidence)) {
      lead = 'The answer looks limited:';
    } else if (/\b(?:available|can|supports?|allows?|added|works?|possible)\b/.test(evidence)) {
      lead = 'Yes, with caveats:';
    }
  }

  const [primary, ...rest] = uniqueSignals;
  const support = rest.slice(0, 2).join(' ');
  return {
    answer: support ? `${lead} ${primary} ${support}` : `${lead} ${primary}`,
    fallback: true,
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

function buildPrompt(query: string, results: SearchResult[]): string {
  const packedSources = results.slice(0, 8).map((item, index) => ({
    id: index + 1,
    title: clean(item.title).slice(0, 180),
    source: sourceName(item),
    url: clean(item.url).slice(0, 300),
    text: clean(item.content || item.snippet).slice(0, 1800),
  }));

  return `You are Pearl's search answer synthesizer. The user asked: "${query}"

Use the source text as private evidence and answer the user like a normal person.

Rules:
- Do not paste search results, headlines, result titles, snippets, URLs, citation brackets, source names, or tool/process language.
- Do not say "search results", "I found", "according to sources", or "based on the results".
- Synthesize the answer in 1-3 short paragraphs.
- If the question is yes/no, start with "Yes", "No", or "Partly", then give the caveat.
- Use only what the evidence supports. If evidence is thin or conflicting, say the uncertainty plainly.
- Return valid JSON only. No markdown.

Schema:
{
  "answer": "plain conversational answer"
}

Evidence:
${JSON.stringify(packedSources, null, 2)}`;
}

async function synthesizeWithModel(query: string, results: SearchResult[]) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (OPENCLAW_TOKEN) headers.Authorization = `Bearer ${OPENCLAW_TOKEN}`;

  const response = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: SEARCH_ANSWER_MODEL,
      messages: [{ role: 'user', content: buildPrompt(query, results) }],
      temperature: 0.2,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(22000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`openclaw_${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = String(data.choices?.[0]?.message?.content || '');
  const parsed = extractJsonObject(content) as { answer?: unknown };
  const answer = clean(parsed.answer);
  if (!answer || looksLikeRawSearchDump(answer, results)) throw new Error('bad_search_answer');
  return { answer };
}

export async function POST(req: NextRequest) {
  const testMode = isTestModeBypassAllowed();
  const session = await getSessionSafely(req, interfaceAuthOptions);
  if (!testMode && !session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { query?: string; results?: SearchResult[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const query = clean(body.query);
  const results = Array.isArray(body.results) ? body.results : [];
  const usable = results
    .map((item) => ({
      title: clean(item.title),
      url: clean(item.url),
      snippet: clean(item.snippet),
      source: clean(item.source),
      content: clean(item.content),
    }))
    .filter((item) => item.title || item.snippet || item.content || item.url)
    .slice(0, 10);

  if (!query || usable.length === 0) {
    return NextResponse.json({ error: 'query_and_sources_required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await synthesizeWithModel(query, usable));
  } catch (error) {
    log.warn('Falling back to local search answer synthesis', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(fallbackAnswer(query, usable));
  }
}
