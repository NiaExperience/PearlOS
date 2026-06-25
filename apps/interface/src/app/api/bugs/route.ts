import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
const STATUSES = ['Open', 'Investigating', 'Fix In Progress', 'Resolved', 'Won\'t Fix'] as const;
const ENVIRONMENTS = ['Staging', 'Production', 'Both'] as const;

const CreateBugSchema = z.object({
  title: z.string().min(3).max(200),
  reportedBy: z.string().min(1).max(100),
  priority: z.enum(PRIORITIES).default('P2'),
  status: z.enum(STATUSES).default('Open'),
  environment: z.enum(ENVIRONMENTS).default('Production'),
  discordLink: z.string().url().optional(),
  description: z.string().max(2000).optional(),
});

const UpdateBugSchema = z.object({
  pageId: z.string().min(1),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  description: z.string().max(2000).optional(),
});

function getNotionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function getNotionConfig() {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_BUGS_DB_ID;
  if (!apiKey || !dbId) {
    return null;
  }
  return { apiKey, dbId };
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.message === 'string' && data.message.trim()) return data.message;
    if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  } catch {}
  try {
    const text = await response.text();
    return text.trim() || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** POST /api/bugs — create a new bug entry */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const config = getNotionConfig();
  if (!config) {
    return NextResponse.json({ error: 'Notion bug tracker not configured (set NOTION_BUGS_DB_ID)' }, { status: 500 });
  }

  let payload: unknown;
  try { payload = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateBugSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const { title, reportedBy, priority, status, environment, discordLink, description } = parsed.data;
  const now = new Date().toISOString();

  try {
    const properties: Record<string, unknown> = {
      'Title': { title: [{ text: { content: title } }] },
      'Reported By': { rich_text: [{ text: { content: reportedBy } }] },
      'Priority': { select: { name: priority } },
      'Status': { select: { name: status } },
      'Environment': { select: { name: environment } },
      'Date': { date: { start: now.slice(0, 10) } },
    };

    if (discordLink) {
      properties['Discord Link'] = { url: discordLink };
    }
    if (description) {
      properties['Description'] = { rich_text: [{ text: { content: description } }] };
    }

    const response = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: getNotionHeaders(),
      body: JSON.stringify({ parent: { database_id: config.dbId }, properties }),
    });

    if (!response.ok) {
      const err = await readResponseError(response);
      return NextResponse.json({ error: `Notion create failed: ${err}` }, { status: 502 });
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      pageId: data.id,
      url: data.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/bugs — update an existing bug (status, priority, description) */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const config = getNotionConfig();
  if (!config) {
    return NextResponse.json({ error: 'Notion bug tracker not configured' }, { status: 500 });
  }

  let payload: unknown;
  try { payload = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateBugSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const { pageId, status, priority, description } = parsed.data;
  const properties: Record<string, unknown> = {};

  if (status) properties['Status'] = { select: { name: status } };
  if (priority) properties['Priority'] = { select: { name: priority } };
  if (description) properties['Description'] = { rich_text: [{ text: { content: description } }] };

  if (Object.keys(properties).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const response = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH',
      headers: getNotionHeaders(),
      body: JSON.stringify({ properties }),
    });

    if (!response.ok) {
      const err = await readResponseError(response);
      return NextResponse.json({ error: `Notion update failed: ${err}` }, { status: 502 });
    }

    const data = await response.json();
    return NextResponse.json({ success: true, pageId: data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET /api/bugs — list all bugs */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const config = getNotionConfig();
  if (!config) {
    return NextResponse.json({ error: 'Notion bug tracker not configured' }, { status: 500 });
  }

  try {
    const response = await fetch(`${NOTION_API}/databases/${config.dbId}/query`, {
      method: 'POST',
      headers: getNotionHeaders(),
      body: JSON.stringify({
        sorts: [{ property: 'Date', direction: 'descending' }],
      }),
    });

    if (!response.ok) {
      const err = await readResponseError(response);
      return NextResponse.json({ error: `Notion query failed: ${err}` }, { status: 502 });
    }

    const data = await response.json();
    const bugs = data.results.map((page: any) => ({
      pageId: page.id,
      url: page.url,
      title: page.properties?.Title?.title?.[0]?.text?.content || '',
      reportedBy: page.properties?.['Reported By']?.rich_text?.[0]?.text?.content || '',
      priority: page.properties?.Priority?.select?.name || '',
      status: page.properties?.Status?.select?.name || '',
      environment: page.properties?.Environment?.select?.name || '',
      date: page.properties?.Date?.date?.start || '',
      discordLink: page.properties?.['Discord Link']?.url || '',
      description: page.properties?.Description?.rich_text?.[0]?.text?.content || '',
      createdAt: page.created_time,
      updatedAt: page.last_edited_time,
    }));

    return NextResponse.json({ success: true, bugs, total: bugs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
