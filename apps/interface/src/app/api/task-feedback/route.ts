import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

import {
  resolveInterfaceActorContext,
  type InterfaceActorContext,
} from '@interface/lib/tenant-actor';

export const dynamic = 'force-dynamic';

const FEEDBACK_DIR = path.join(process.cwd(), '.data', 'task-feedback');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.jsonl');
const IMAGES_DIR = path.join(FEEDBACK_DIR, 'images');

async function ensureDirs() {
  await fs.mkdir(FEEDBACK_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

function gatewayHeaders(actor?: InterfaceActorContext): Record<string, string> {
  const secret = process.env.BOT_CONTROL_SHARED_SECRET || process.env.PEARL_TASKS_BOT_SECRET || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) {
    headers['X-Bot-Secret'] = secret;
    headers['Authorization'] = `Bearer ${secret}`;
  }
  if (actor) {
    headers['X-User-Id'] = actor.userId;
    headers['X-User-Email'] = actor.userEmail;
    headers['X-Pearl-Tenant-Id'] = actor.tenantId;
  }
  return headers;
}

async function markTaskNeedsRework(
  taskId: string,
  notes: string,
  actor: InterfaceActorContext,
): Promise<{ ok: boolean; error?: string }> {
  const botControlUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || process.env.BOT_GATEWAY_URL || 'http://localhost:4444';
  const baseUrl = botControlUrl.replace(/\/$/, '');
  try {
    const current = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
      headers: gatewayHeaders(actor),
      cache: 'no-store',
    });
    if (!current.ok) {
      const text = await current.text().catch(() => '');
      console.error(`[task-feedback] Scoped task lookup failed (${current.status}):`, text);
      return { ok: false, error: `Gateway returned ${current.status}` };
    }
    if (current.ok) {
      const data = await current.json().catch(() => null);
      if (data?.task?.status === 'in_progress') {
        const noteOnly = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PATCH',
          headers: gatewayHeaders(actor),
          body: JSON.stringify({
            note: notes || 'rework requested while task was already running',
          }),
        });
        if (!noteOnly.ok) {
          const text = await noteOnly.text().catch(() => '');
          console.error(`[task-feedback] In-progress note patch failed (${noteOnly.status}):`, text);
          return { ok: false, error: `Gateway returned ${noteOnly.status}` };
        }
        return { ok: true };
      }
    }

    const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: gatewayHeaders(actor),
      body: JSON.stringify({
        status: 'pending',
        assignee: 'claude_cli',
        urgency: 'urgent',
        note: notes || 'rework requested from thumbs-down feedback',
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[task-feedback] Rework patch failed (${response.status}):`, text);
      return { ok: false, error: `Gateway returned ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    console.error('[task-feedback] Rework patch error:', error);
    return { ok: false, error: String(error) };
  }
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
    const actorResult = await resolveInterfaceActorContext({ request: req });
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;

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
      requesterUserId: actor.userId,
      requesterEmail: actor.userEmail,
      requesterTenantId: actor.tenantId,
      createdAt: new Date().toISOString(),
    };

    // Append to JSONL file
    await fs.appendFile(FEEDBACK_FILE, JSON.stringify(entry) + '\n');

    // If negative feedback with relaunch requested, trigger agent re-run
    let relaunchResult = null;
    let reworkResult = null;
    if (type === 'down') {
      reworkResult = await markTaskNeedsRework(taskId, notes, actor);
      if (relaunch && notes.trim()) {
        relaunchResult = await relaunchTaskWithFeedback(taskName, taskDescription, notes);
      }
    }

    return NextResponse.json({ ok: true, entry, rework: reworkResult, relaunch: relaunchResult });
  } catch (error) {
    console.error('[task-feedback] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actorResult = await resolveInterfaceActorContext({ request: req });
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;

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

    feedback = feedback.filter((f: {
      requesterUserId?: string;
      requesterEmail?: string;
      requesterTenantId?: string;
    }) => (
      f.requesterTenantId === actor.tenantId &&
      (f.requesterUserId === actor.userId || String(f.requesterEmail || '').toLowerCase() === actor.userEmail)
    ));

    if (taskId) {
      feedback = feedback.filter((f: { taskId: string }) => f.taskId === taskId);
    }

    return NextResponse.json({ feedback });
  } catch (error) {
    console.error('[task-feedback] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
