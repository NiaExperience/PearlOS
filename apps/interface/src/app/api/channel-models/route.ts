import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

const CONFIG_PATH = join(process.cwd(), 'public', 'pearl-channel-models.json');

export async function GET() {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json({
      primaryModel: '',
      channels: {
        discord: { model: '', enabled: true },
        telegram: { model: '', enabled: true },
        voice: { model: '', enabled: true },
        webchat: { model: '', enabled: true },
      },
      updatedAt: null,
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await writeFile(CONFIG_PATH, JSON.stringify(body, null, 2), 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save' },
      { status: 500 }
    );
  }
}
