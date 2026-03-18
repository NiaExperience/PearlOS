import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FEEDBACK_DIR = path.join(process.cwd(), '.data', 'task-feedback');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.jsonl');
const IMAGES_DIR = path.join(FEEDBACK_DIR, 'images');

async function ensureDirs() {
  await fs.mkdir(FEEDBACK_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

/**
 * Relaunch a task via the OpenClaw bot gateway with feedback context.
 * Sends the original task + user feedback so the agent can redo it.
 */
async function relaunchTaskWithFeedback(taskName: string, taskDescription: string, feedbackNotes: string): Promise<{ ok: boolean; error?: string }> {
  const botControlUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';
  
  const relaunchPrompt = [
    `RELAUNCH — User gave negative feedback on task "${taskName}".`,
    taskDescription ? `Original task: ${taskDescription}` : '',
    `User feedback: ${feedbackNotes}`,
    `Please redo this task, addressing the user's feedback.`,
  ].filter(Boolean).join('\n');

  try {
    // Use the bot gateway's message endpoint to trigger a new agent run
    const response = await fetch(`${botControlUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: relaunchPrompt,
        channel: 'task-feedback-relaunch',
        source: 'task-feedback',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[task-feedback] Relaunch failed (${response.status}):`, text);
      return { ok: false, error: `Gateway returned ${response.status}` };
    }

    const result = await response.json();
    console.log(`[task-feedback] Task relaunched:`, result);
    return { ok: true };
  } catch (error) {
    console.error('[task-feedback] Relaunch error:', error);
    return { ok: false, error: String(error) };
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await ensureDirs();

    const contentType = req.headers.get('content-type') || '';

    let taskId: string;
    let taskName: string;
    let type: string;
    let notes: string;
    let timestamp: string;
    let mode: string;
    let taskDescription: string;
    let relaunch = false;
    const imagePaths: string[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      taskId = formData.get('taskId') as string || '';
      taskName = formData.get('taskName') as string || '';
      type = formData.get('type') as string || 'down';
      notes = formData.get('notes') as string || '';
      timestamp = formData.get('timestamp') as string || String(Date.now());
      mode = formData.get('mode') as string || 'text';
      taskDescription = formData.get('taskDescription') as string || '';
      relaunch = formData.get('relaunch') === 'true';

      // Save images
      const imageFiles = formData.getAll('images');
      for (const file of imageFiles) {
        if (file instanceof File && file.size > 0) {
          const ext = file.name.split('.').pop() || 'png';
          const filename = `${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const filepath = path.join(IMAGES_DIR, filename);
          const buffer = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(filepath, buffer);
          imagePaths.push(filename);
        }
      }
    } else {
      const body = await req.json();
      taskId = body.taskId || '';
      taskName = body.taskName || '';
      type = body.type || 'up';
      notes = body.notes || '';
      timestamp = body.timestamp ? String(body.timestamp) : String(Date.now());
      mode = body.mode || 'text';
      taskDescription = body.taskDescription || '';
      relaunch = body.relaunch === true || body.relaunch === 'true';
    }

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const entry = {
      taskId,
      taskName,
      type,
      notes,
      images: imagePaths,
      timestamp: Number(timestamp),
      mode,
      taskDescription,
      createdAt: new Date().toISOString(),
    };

    // Append to JSONL file
    await fs.appendFile(FEEDBACK_FILE, JSON.stringify(entry) + '\n');

    // If negative feedback with relaunch requested, trigger agent re-run
    let relaunchResult = null;
    if (type === 'down' && relaunch && notes.trim()) {
      relaunchResult = await relaunchTaskWithFeedback(taskName, taskDescription, notes);
    }

    return NextResponse.json({ ok: true, entry, relaunch: relaunchResult });
  } catch (error) {
    console.error('[task-feedback] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await ensureDirs();

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get('taskId');

    let content: string;
    try {
      content = await fs.readFile(FEEDBACK_FILE, 'utf-8');
    } catch {
      return NextResponse.json({ feedback: [] });
    }

    const lines = content.trim().split('\n').filter(Boolean);
    let feedback = lines.map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    if (taskId) {
      feedback = feedback.filter((f: { taskId: string }) => f.taskId === taskId);
    }

    return NextResponse.json({ feedback });
  } catch (error) {
    console.error('[task-feedback] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
