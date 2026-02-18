/* eslint-disable import/order */
import { NextRequest, NextResponse } from 'next/server';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { FunctionalPromptActions } from '@nia/prism/core/actions';
import { GET_impl, POST_impl, PUT_impl, DELETE_impl } from '@nia/prism/core/routes/functionalPrompt/route';

export const dynamic = 'force-dynamic';

// Check if we should bypass auth for local development
function shouldBypassAuth(req: NextRequest): boolean {
  const disableAuth = process.env.DISABLE_DASHBOARD_AUTH === 'true' &&
    (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1') &&
    process.env.NODE_ENV !== 'production';
  return disableAuth;
}

export async function GET(req: NextRequest) {
  // Bypass auth for local dev
  if (shouldBypassAuth(req)) {
    try {
      const { searchParams } = new URL(req.url);
      const featureKey = searchParams.get('featureKey');

      if (featureKey) {
        const prompt = await FunctionalPromptActions.findByFeatureKey(featureKey);
        return NextResponse.json(prompt);
      } else {
        const prompts = await FunctionalPromptActions.listAll();
        return NextResponse.json(prompts);
      }
    } catch (error) {
      console.error('[functionalPrompt] Error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
  return GET_impl(req, dashboardAuthOptions);
}

export async function POST(req: NextRequest) {
  // Bypass auth for local dev
  if (shouldBypassAuth(req)) {
    try {
      const body = await req.json();
      const { featureKey, promptContent, userId = 'local-dev-user' } = body;
      
      if (!featureKey) {
        return NextResponse.json({ error: 'featureKey is required' }, { status: 400 });
      }

      const result = await FunctionalPromptActions.createOrUpdate(
        featureKey,
        promptContent || '',
        userId
      );
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      console.error('[functionalPrompt] Error creating:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
  return POST_impl(req, dashboardAuthOptions);
}

export async function PUT(req: NextRequest) {
  // PUT is alias for POST
  if (shouldBypassAuth(req)) {
    return POST(req);
  }
  return PUT_impl(req, dashboardAuthOptions);
}

export async function DELETE(req: NextRequest) {
  // Bypass auth for local dev
  if (shouldBypassAuth(req)) {
    try {
      const { searchParams } = new URL(req.url);
      const featureKey = searchParams.get('featureKey');

      if (!featureKey) {
        return NextResponse.json({ error: 'featureKey is required' }, { status: 400 });
      }

      const deleted = await FunctionalPromptActions.deleteByFeatureKey(featureKey);
      if (!deleted) {
        return NextResponse.json({ error: 'Functional prompt not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, featureKey });
    } catch (error) {
      console.error('[functionalPrompt] Error deleting:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
  return DELETE_impl(req, dashboardAuthOptions);
}

