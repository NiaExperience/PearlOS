import { NextRequest, NextResponse } from 'next/server';

import { generateWikipediaUrl, WikipediaSearchResponse } from '../lib/generate-wikipedia-url';

import { getLogger } from '@interface/lib/logger';

const logger = getLogger('WikipediaRoute');

export async function POST_impl(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, userRequest } = body || {};
    if (!query || !userRequest) {
      return NextResponse.json(
        { error: 'Query and userRequest are required', message: 'Provide both the search query and original user request' },
        { status: 400 }
      );
    }
    const wikipediaUrl = generateWikipediaUrl(query);
    const response: WikipediaSearchResponse = {
      success: true,
      action: 'OPEN_WIKIPEDIA_ARTICLE',
      query,
      userRequest,
      wikipediaUrl,
      message: `Opening Wikipedia article about "${query}" in the mini-browser.`,
      payload: { app: 'browser', url: wikipediaUrl, searchReason: `Wikipedia search for: ${query}` },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (error) {
    logger.error('Wikipedia search POST error', { error });
    return NextResponse.json({ error: 'Failed to process Wikipedia search' }, { status: 500 });
  }
}

export async function GET_impl(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const userRequest = searchParams.get('userRequest') || (query ? `Search for ${query}` : '');
  if (!query) {
    return NextResponse.json({ error: 'Query parameter is required for testing' }, { status: 400 });
  }
  const wikipediaUrl = generateWikipediaUrl(query);
  const response: WikipediaSearchResponse = {
    success: true,
    action: 'OPEN_WIKIPEDIA_ARTICLE',
    query,
    userRequest,
    wikipediaUrl,
    message: `Test Wikipedia search for: ${query}`,
    payload: { app: 'browser', url: wikipediaUrl, searchReason: `Wikipedia search test for: ${query}` },
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(response);
}
