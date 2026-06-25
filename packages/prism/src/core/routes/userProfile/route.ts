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

function normalizeEmail(email: string | null | undefined): string {
    return String(email || '').trim().toLowerCase();
}

function sessionIdentity(session: any): { userId: string; email: string } | NextResponse {
    const userId = session?.user?.id ? String(session.user.id) : '';
    const email = normalizeEmail(session?.user?.email);
    if (!userId || !email) {
        return NextResponse.json({ error: 'Missing authenticated user identity' }, { status: 401 });
    }
    return { userId, email };
}

function profileBelongsToSession(profile: any, identity: { userId: string; email: string }): boolean {
    if (!profile) return false;
    const profileUserId = profile.userId ? String(profile.userId) : '';
    const profileEmail = normalizeEmail(profile.email);
    return profileUserId === identity.userId && (!profileEmail || profileEmail === identity.email);
}

export async function POST_impl(request: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
    const authErr = await requireAuth(request, authOptions);
    if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });

    const session = await getSessionSafely(request, authOptions);
    const identity = sessionIdentity(session);
    if (identity instanceof NextResponse) return identity;

    log.info('UserProfile POST');
    try {
        const body = await request.json();
        const { first_name, publicPersona, privateMemory, onboardingComplete, onboardingState } = body || {};
        if (!first_name) {
            log.warn('UserProfile POST missing required fields', { first_name });
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        const userProfile = await UserProfileActions.createOrUpdateUserProfile(
            { first_name, email: identity.email, publicPersona, privateMemory, onboardingComplete, onboardingState, userId: identity.userId },
            false
        );
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
        const session = await getSessionSafely(req, authOptions);
        const identity = sessionIdentity(session);
        if (identity instanceof NextResponse) return identity;
        const { searchParams } = new URL(req.url);
        const requestedUserId = searchParams.get('userId') || undefined;
        if (requestedUserId && requestedUserId !== identity.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const prism = await Prism.getInstance();
        const query = {
            contentType: BlockType_UserProfile,
            where: {
                type: { eq: BlockType_UserProfile },
                indexer: { path: 'userId', equals: identity.userId },
            },
            limit: 1,
            offset: 0,
            orderBy: { createdAt: 'desc' },
        } as any;
        const op = async () => await prism.query(query);

        const result = await UserProfileActions.ensureUserProfileDefinition(op);

        // Migrate any legacy `metadata` on the way out so clients only see the new shape.
        if (result.items && result.items.length > 0) {
            result.items = result.items.map((item: any) => UserProfileActions.migrateUserProfileRecord(item));
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
        const session = await getSessionSafely(req, authOptions);
        const identity = sessionIdentity(session);
        if (identity instanceof NextResponse) return identity;
        const { id, first_name, publicPersona, privateMemory, onboardingComplete, onboardingState } = body || {};
        if (process.env.DEBUG_PRISM === 'true') {
            log.info('UserProfile PUT payload', { id, publicPersona, privateMemory, onboardingComplete, onboardingState });
        }
        const removeUserId = false;
        if (id) {
            const existing = await UserProfileActions.findById(id);
            if (existing?.userProfile && !profileBelongsToSession(existing.userProfile, identity)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const userProfile = await UserProfileActions.createOrUpdateUserProfile({
            id,
            first_name,
            userId: identity.userId,
            email: identity.email,
            publicPersona,
            privateMemory,
            onboardingComplete,
            onboardingState
        }, removeUserId);

        log.info('UserProfile PUT updated', { id, userId: identity.userId, email: identity.email });
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
        const session = await getSessionSafely(req, authOptions);
        const identity = sessionIdentity(session);
        if (identity instanceof NextResponse) return identity;
        const { id, first_name, publicPersona, privateMemory, onboardingComplete, onboardingState, overlayDismissed } = body || {};
        const removeUserId = false;
        if (id) {
            const existing = await UserProfileActions.findById(id);
            if (existing?.userProfile && !profileBelongsToSession(existing.userProfile, identity)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const updateData: any = { id };
        if (first_name !== undefined) updateData.first_name = first_name;
        updateData.userId = identity.userId;
        updateData.email = identity.email;
        if (publicPersona !== undefined) updateData.publicPersona = publicPersona;
        if (privateMemory !== undefined) updateData.privateMemory = privateMemory;
        if (onboardingComplete !== undefined) updateData.onboardingComplete = onboardingComplete;
        if (onboardingState !== undefined) updateData.onboardingState = onboardingState;
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
