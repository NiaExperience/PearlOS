import { NextResponse } from 'next/server';
import { getJob } from '../../jobStore';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/summon-ai-sprite/job/:id
 *
 * Look up the lifecycle state of a sprite-summon job. The client polls
 * this on remount when its persisted state is `pending` so a generation
 * that finished while the panel/tab was closed can be picked up and
 * rendered, instead of being abandoned as an "interrupted" error. See
 * SPECTRUM bug #4.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 });
  }
  return NextResponse.json({ job });
}
