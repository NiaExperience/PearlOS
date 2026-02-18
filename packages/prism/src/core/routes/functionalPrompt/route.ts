/**
 * Prism routes for FunctionalPrompt management
 * Handles CRUD operations for platform-wide functional prompts
 */

import { FunctionalPromptActions } from '@nia/prism/core/actions';
import { requireAuth, getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import { z } from 'zod';
import { getLogger } from '../../logger';

const log = getLogger('prism:route:functionalPrompt');

/**
 * GET /api/functionalPrompt
 * Query parameters:
 * - featureKey: (optional) Get specific prompt by feature key
 * 
 * Returns:
 * - If featureKey provided: Single functional prompt or null
 * - If no featureKey: Array of all functional prompts
 */
export async function GET_impl(request: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  // Check authentication
  const authError = await requireAuth(request, authOptions);
  if (authError) {
    return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const featureKey = searchParams.get('featureKey');

    if (featureKey) {
      // Get specific prompt by feature key
      const prompt = await FunctionalPromptActions.findByFeatureKey(featureKey);
      return NextResponse.json(prompt);
    } else {
      // List all prompts
      const prompts = await FunctionalPromptActions.listAll();
      return NextResponse.json(prompts);
    }
  } catch (error) {
    log.error('Error in GET /api/functionalPrompt', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/functionalPrompt
 * Create or update a functional prompt
 * 
 * Body:
 * - featureKey: string (required)
 * - promptContent: string (required)
 * - userId: string (optional, defaults to session user)
 */
export async function POST_impl(request: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  // Check authentication
  const authError = await requireAuth(request, authOptions);
  if (authError) {
    return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  }

  try {
    const session = await getSessionSafely(request, authOptions);
    const body = await request.json();
    
    // Validate request body
    const CreateRequestSchema = z.object({
      featureKey: z.string().min(1),
      promptContent: z.string(),
      userId: z.string().optional(),
    });

    const validatedData = CreateRequestSchema.parse(body);
    const userId = validatedData.userId || session?.user?.id;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID could not be determined' },
        { status: 400 }
      );
    }

    // Create or update the prompt
    const result = await FunctionalPromptActions.createOrUpdate(
      validatedData.featureKey,
      validatedData.promptContent,
      userId
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }
    log.error('Error in POST /api/functionalPrompt', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/functionalPrompt
 * Alias for POST - creates or updates a functional prompt
 * Included for RESTful convention
 */
export async function PUT_impl(request: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  return POST_impl(request, authOptions);
}

/**
 * DELETE /api/functionalPrompt
 * Delete a functional prompt by feature key
 * 
 * Query parameters:
 * - featureKey: string (required)
 */
export async function DELETE_impl(request: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  // Check authentication
  const authError = await requireAuth(request, authOptions);
  if (authError) {
    return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const featureKey = searchParams.get('featureKey');

    if (!featureKey) {
      return NextResponse.json(
        { error: 'featureKey is required' },
        { status: 400 }
      );
    }

    const deleted = await FunctionalPromptActions.deleteByFeatureKey(featureKey);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Functional prompt not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, featureKey });
  } catch (error) {
    log.error('Error in DELETE /api/functionalPrompt', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
