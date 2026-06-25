import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

/**
 * /api/news/config — User-controllable news feed configuration.
 *
 * GET  — returns current feed configuration
 * POST — updates feed configuration (add/remove/toggle feeds)
 *
 * Config is stored at /tmp/pearlos-news-config.json
 */

const CONFIG_PATH = '/tmp/pearlos-news-config.json';

async function requireTenantAdmin(request: NextRequest): Promise<NextResponse | null> {
  const actorResult = await resolveInterfaceActorContext({
    request,
    minimumRole: TenantRole.ADMIN,
  });
  return actorResult.ok ? null : actorResult.response;
}

interface FeedConfig {
  url: string;
  name: string;
  enabled: boolean;
}

interface NewsConfig {
  feeds: FeedConfig[];
  updatedAt: string;
}

const DEFAULT_CONFIG: NewsConfig = {
  feeds: [
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', name: 'NY Times', enabled: true },
    { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News', enabled: true },
    { url: 'https://feeds.reuters.com/reuters/topNews', name: 'Reuters', enabled: true },
    { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', enabled: true },
    { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', enabled: true },
  ],
  updatedAt: new Date().toISOString(),
};

async function loadConfig(): Promise<NewsConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as NewsConfig;
    if (Array.isArray(config.feeds)) {
      return config;
    }
  } catch {
    // File doesn't exist or is invalid — use defaults
  }
  return { ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() };
}

async function saveConfig(config: NewsConfig): Promise<void> {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  const authError = await requireTenantAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action, feed, feeds: newFeeds } = body as {
      action?: 'add' | 'remove' | 'toggle' | 'replace' | 'reset';
      feed?: FeedConfig;
      feeds?: FeedConfig[];
    };

    const config = await loadConfig();

    switch (action) {
      case 'add': {
        if (!feed?.url || !feed?.name) {
          return NextResponse.json({ error: 'Feed must have url and name' }, { status: 400 });
        }
        // Avoid duplicates
        const exists = config.feeds.some(f => f.url === feed.url);
        if (exists) {
          return NextResponse.json({ error: 'Feed URL already exists' }, { status: 409 });
        }
        config.feeds.push({
          url: feed.url,
          name: feed.name,
          enabled: feed.enabled !== false,
        });
        break;
      }

      case 'remove': {
        if (!feed?.url) {
          return NextResponse.json({ error: 'Feed url required' }, { status: 400 });
        }
        config.feeds = config.feeds.filter(f => f.url !== feed.url);
        break;
      }

      case 'toggle': {
        if (!feed?.url) {
          return NextResponse.json({ error: 'Feed url required' }, { status: 400 });
        }
        const target = config.feeds.find(f => f.url === feed.url);
        if (target) {
          target.enabled = !target.enabled;
        } else {
          return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
        }
        break;
      }

      case 'replace': {
        if (!Array.isArray(newFeeds)) {
          return NextResponse.json({ error: 'feeds array required' }, { status: 400 });
        }
        config.feeds = newFeeds;
        break;
      }

      case 'reset': {
        config.feeds = [...DEFAULT_CONFIG.feeds];
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action. Use: add, remove, toggle, replace, reset' }, { status: 400 });
    }

    config.updatedAt = new Date().toISOString();
    await saveConfig(config);

    return NextResponse.json(config);
  } catch (err) {
    console.error('[news/config] Error:', err);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
