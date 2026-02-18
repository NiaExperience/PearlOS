/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { Prism } from '@nia/prism';
import * as UserProfileActions from '@nia/prism/core/actions/userProfile-actions';
import { requireAuth, getSessionSafely } from '@nia/prism/core/auth';
import { BlockType_UserProfile } from '@nia/prism/core/blocks/userProfile.block';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';

import { getLogger } from '../../logger';

const log = getLogger('prism:routes:userProfile');

export async function POST_impl(request: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
    const authErr = await requireAuth(request, authOptions);
    if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });

    const session = await getSessionSafely(request, authOptions);
    const userId = session?.user?.id;

    log.info('UserProfile POST');
    try {
        const body = await request.json();
        const { first_name, email, metadata, onboardingComplete } = body || {};
        if (!first_name || !email) {
            log.warn('UserProfile POST missing required fields', { first_name, email });
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        const userProfile = await UserProfileActions.createOrUpdateUserProfile({ first_name, email, metadata, onboardingComplete, userId }, false);
        if (!userProfile) {
            log.error('Failed to create or update UserProfile');
            return NextResponse.json({ error: 'Failed to create or update UserProfile' }, { status: 500 });
        }
        return NextResponse.json({ success: true, data: userProfile }, { status: 201 });
    } catch (e) {
        if ((e as Error).message === 'DUPLICATE_EMAIL') {
            return NextResponse.json({ duplicate: true, error: 'Email already exists' }, { status: 409 });
        }
        log.error('Error creating/updating UserProfile', { error: e });
        return NextResponse.json(
            { message: 'Error searching for existing UserProfile' },
            { status: 500 }
        );
    }
}

// Reading UserProfiles requires at least authentication
// GET /api/userProfile?tlimit=...&offset=...
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions) {
    const authErr = await requireAuth(req, authOptions);
    if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });

    try {
        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get('limit') || '100', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);
        const userId = searchParams.get('userId') || undefined;

        const prism = await Prism.getInstance();
        const query = {
            contentType: BlockType_UserProfile,
            where: {
                type: { eq: BlockType_UserProfile },
            },
            limit,
            offset,
            orderBy: { createdAt: 'desc' },
        } as any;
        if (userId) {
            query.where.indexer = { path: 'userId', equals: userId };
        }
        const op = async () => await prism.query(query);

        const result = await UserProfileActions.ensureUserProfileDefinition(op);
        
        // Normalize metadata for all returned items
        if (result.items && result.items.length > 0) {
            result.items = result.items.map((item: any) => {
                if (item.metadata) {
                    item.metadata = UserProfileActions.normalizeMetadata(item.metadata);
                }
                return item;
            });
        }
        
        return NextResponse.json({ total: result.total, items: result.items });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Failed to list UserProfile records' }, { status: 500 });
    }
}

// Updating UserProfiles requires at least authentication
// PUT /api/userProfile  { id, email }
export async function PUT_impl(req: NextRequest, authOptions: NextAuthOptions) {
    const authErr = await requireAuth(req, authOptions);
    if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });

    try {
        const body = await req.json();
        const { id, first_name, userId, email, metadata, metadataOperation, onboardingComplete } = body || {};
        if (process.env.DEBUG_PRISM === 'true') {
            log.info('UserProfile PUT payload', { id, metadata, metadataOperation, onboardingComplete });
        }
        const removeUserId = req.headers.get('x-remove-user-id') === 'true';
        
        const userProfile = await UserProfileActions.createOrUpdateUserProfile({ 
            id, 
            first_name, 
            userId, 
            email, 
            metadata,
            metadataOperation,
            onboardingComplete
        }, removeUserId);
        
        log.info('UserProfile PUT updated', { id, userId, email });
        if (!userProfile) {
            return NextResponse.json({ error: 'Failed to update UserProfile' }, { status: 400 });
        }
        return NextResponse.json({ success: true, data: userProfile }, { status: 200 });
    } catch (e: any) {
        if (e.message === 'DUPLICATE_EMAIL') {
            return NextResponse.json({ duplicate: true, error: 'Email already exists' }, { status: 409 });
        }
        return NextResponse.json({ error: e.message || 'Failed to update UserProfile' }, { status: 400 });
    }
}

// PATCH /api/userProfile  { id, ...partial fields }
// Performs partial update - only updates provided fields
export async function PATCH_impl(req: NextRequest, authOptions: NextAuthOptions) {
    const authErr = await requireAuth(req, authOptions);
    if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });

    try {
        const body = await req.json();
        const { id, first_name, userId, email, metadata, onboardingComplete, overlayDismissed } = body || {};
        const removeUserId = req.headers.get('x-remove-user-id') === 'true';
        
        // PATCH uses the same action but only passes provided fields
        const updateData: any = { id };
        if (first_name !== undefined) updateData.first_name = first_name;
        if (userId !== undefined) updateData.userId = userId;
        if (email !== undefined) updateData.email = email;
        if (metadata !== undefined) updateData.metadata = metadata;
        if (onboardingComplete !== undefined) updateData.onboardingComplete = onboardingComplete;
        if (overlayDismissed !== undefined) updateData.overlayDismissed = overlayDismissed;
        
        const userProfile = await UserProfileActions.createOrUpdateUserProfile(updateData, removeUserId);
        if (!userProfile) {
            return NextResponse.json({ error: 'Failed to update UserProfile' }, { status: 400 });
        }
        return NextResponse.json({ success: true, data: userProfile }, { status: 200 });
    } catch (e: any) {
        if (e.message === 'DUPLICATE_EMAIL') {
            return NextResponse.json({ duplicate: true, error: 'Email already exists' }, { status: 409 });
        }
        return NextResponse.json({ error: e.message || 'Failed to update UserProfile' }, { status: 400 });
    }
}

// Deleting UserProfiles requires at least authentication
// DELETE /api/userProfile  { id, tenantId }
export async function DELETE_impl(req: NextRequest, authOptions: NextAuthOptions) {
    const authErr = await requireAuth(req, authOptions);
    if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
    try {
        const body = await req.json();
        const { id } = body || {};
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        const prism = await Prism.getInstance();
        const op = async () => await prism.delete(BlockType_UserProfile, id);
        const result = await UserProfileActions.ensureUserProfileDefinition(op);
        const ok = !!result && ((result as any).total === undefined || (result as any).total >= 0);
        return NextResponse.json({ success: ok, id });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Failed to delete UserProfile' }, { status: 400 });
    }
}

