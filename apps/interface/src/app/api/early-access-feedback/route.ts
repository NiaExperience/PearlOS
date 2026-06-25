export const dynamic = 'force-dynamic';

import { requireAuth } from '@nia/prism/core/auth';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_early_access_feedback]');

/**
 * POST /api/early-access-feedback
 *
 * SAFETY: This endpoint accepts text-only feedback from authenticated users.
 * It stores feedback as Prism content and does NOT interact with the task
 * dispatch system, CLI, agents, or any code execution path.
 * The feedback is a plain message from the user to Pearl.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  const session = await getSessionSafely(req, interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!message || message.length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Hard cap for safety
    if (message.length > 2000) {
      return NextResponse.json({ error: 'Message too long (max 2000 characters)' }, { status: 400 });
    }

    const userId = session.user.id;
    const userEmail = session.user.email || 'unknown';
    const userName = session.user.name || userEmail;

    // Store as a simple Prism content record — no task dispatch, no agent
    const { Prism } = await import('@nia/prism');
    const prism = await Prism.getInstance();
    const now = new Date().toISOString();

    await prism.create(
      'EarlyAccessFeedback',
      {
        userId,
        userEmail,
        userName,
        message,
        pageUrl: body.pageUrl || '',
        createdAt: now,
      },
      'any'
    );

    log.info('Early access feedback received', { userId, userEmail, messageLength: message.length });

    return NextResponse.json({
      success: true,
      message: 'Feedback received. Thank you for helping improve PearlOS.',
    });
  } catch (error) {
    log.error('Failed to store early access feedback', { error });
    return NextResponse.json(
      { error: 'Failed to store feedback' },
      { status: 500 }
    );
  }
}
