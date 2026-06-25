import { NextRequest, NextResponse } from 'next/server';

import { fetchOwnedTask, normalize } from '../route';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await ctx.params;
  if (!taskId) {
    return NextResponse.json({ error: 'task_id_required' }, { status: 400 });
  }
  const owned = await fetchOwnedTask(taskId, req);
  if (!owned.ok) return owned.response;
  return NextResponse.json(
    { ok: true, task: normalize(owned.task) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
