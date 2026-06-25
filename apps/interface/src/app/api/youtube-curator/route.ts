import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { composeUserPrompt } from '@interface/app/api/userProfile/prompt/route';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_youtube_curator]');

type CuratorCue = {
  query: string;
  note: string;
  commentary: string;
  nextQueries: string[];
};

const FALLBACK_CUE: CuratorCue = {
  query: 'theme park vlog ride construction rumors Disney Universal analysis',
  note: 'Theme park ride drama, construction rumors, and enough context to make the background TV worth glancing at.',
  commentary: 'Watching for the useful detail: what changed, who noticed, and why this clip is not just thumbnail bait.',
  nextQueries: [
    'latest world events explained geopolitics analysis documentary 2026',
    'movie production stories strange Hollywood history video essay',
    'thoughtful true crime documentary unsolved case analysis timeline',
    'celebrity gossip explained media culture analysis receipts',
    'theme park vlog ride construction rumors Disney Universal analysis',
  ],
};

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeCue(value: unknown): CuratorCue {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nextQueries = Array.isArray(source.nextQueries)
    ? source.nextQueries.map((item) => cleanString(item)).filter(Boolean).slice(0, 5)
    : [];

  return {
    query: cleanString(source.query, FALLBACK_CUE.query).slice(0, 160),
    note: cleanString(source.note, FALLBACK_CUE.note).slice(0, 260),
    commentary: cleanString(source.commentary, FALLBACK_CUE.commentary).slice(0, 320),
    nextQueries: nextQueries.length ? nextQueries : FALLBACK_CUE.nextQueries,
  };
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in curator response');
    return JSON.parse(match[0]);
  }
}

async function callCuratorModel(params: {
  userPrompt: string;
  request: string;
  currentTitle?: string;
}): Promise<CuratorCue | null> {
  const directDeepSeekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const apiKey = directDeepSeekKey || openRouterKey;
  if (!apiKey) return null;

  const baseUrl = directDeepSeekKey
    ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
    : (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = process.env.YOUTUBE_CURATOR_MODEL
    || process.env.BOT_FAST_MODEL
    || process.env.BOT_LLM_MODEL
    || 'deepseek-v4-flash';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 360,
      messages: [
        {
          role: 'system',
          content:
            'You are Pearl acting as a fast YouTube VJ. Return only compact JSON with keys query, note, commentary, nextQueries. Pick playable YouTube search queries, not URLs. Be specific and tasteful.',
        },
        {
          role: 'user',
          content: [
            `User profile context:\n${params.userPrompt.slice(0, 5000)}`,
            `Viewer request or vibe: ${params.request || 'start my custom endless TV channel'}`,
            params.currentTitle ? `Current video: ${params.currentTitle}` : '',
          ].filter(Boolean).join('\n\n'),
        },
      ],
    }),
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) {
    throw new Error(`Curator model failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) return null;
  return normalizeCue(extractJson(text));
}

function fallbackForRequest(request: string): CuratorCue {
  const vibe = request.trim();
  if (!vibe) return FALLBACK_CUE;
  const compactQuery = vibe
    .replace(/\s+/g, ' ')
    .replace(/^play\s+/i, '')
    .replace(/^show\s+me\s+/i, '')
    .slice(0, 140);

  return normalizeCue({
    query: compactQuery,
    note: `I shifted the channel toward "${vibe}" and kept a few adjacent choices ready so it does not dead-end after one clip.`,
    commentary: 'I am treating this like TV programming, not one-off search: one strong pick now, then adjacent material if you skip.',
    nextQueries: [
      `${vibe} best short documentary`,
      `${vibe} live performance`,
      `${vibe} expert interview`,
      `${vibe} video essay`,
    ],
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(interfaceAuthOptions);
    if (!session?.user) {
      return NextResponse.json(fallbackForRequest(''));
    }

    const body = await request.json().catch(() => ({}));
    const viewerRequest = cleanString(body?.request);
    const currentTitle = cleanString(body?.currentTitle);
    const assistantName = cleanString(body?.assistantName, 'Pearl');
    const userPrompt = await composeUserPrompt(session.user, assistantName);

    try {
      const cue = await callCuratorModel({ userPrompt, request: viewerRequest, currentTitle });
      if (cue) return NextResponse.json(cue);
    } catch (error) {
      log.warn('Falling back after curator model failure', {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json(fallbackForRequest(viewerRequest));
  } catch (error) {
    log.error('YouTube curator failed', { error });
    return NextResponse.json(FALLBACK_CUE);
  }
}
