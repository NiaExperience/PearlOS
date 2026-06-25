import { Prism } from '@nia/prism';
import { TenantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { GET_impl, POST_impl, PUT_impl, PATCH_impl } from '@nia/prism/core/routes/userProfile/route';
import { NextRequest, NextResponse } from 'next/server';

import { createNote } from '@interface/features/Notes/actions/notes-actions';
import { getWelcomeNoteContent } from '@interface/features/Notes/lib/welcome-note';
import { welcomeNoteExistsForUser } from '@interface/features/Notes/lib/welcome-note-exists';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_user_profile]');

function roleRank(role: string | undefined): number {
    if (role === 'owner') return 0;
    if (role === 'admin') return 1;
    if (role === 'member') return 2;
    return 3;
}

function preferredTenantId(roles: Array<{ tenantId?: string; role?: string }>): string | null {
    return roles
        .filter((role) => typeof role?.tenantId === 'string' && role.tenantId)
        .sort((a, b) => {
            const rankDiff = roleRank(a.role) - roleRank(b.role);
            if (rankDiff !== 0) return rankDiff;
            return String(a.tenantId).localeCompare(String(b.tenantId));
        })[0]?.tenantId || null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    return GET_impl(req, interfaceAuthOptions);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    // 1. Perform the original profile creation
    const response = await POST_impl(req, interfaceAuthOptions);

    // 2. If successful, try to create the welcome note
    if (response.status === 201) {
        try {
            const session = await getSessionSafely(req, interfaceAuthOptions);
            const userId = session?.user?.id;

            if (userId) {
                const prism = await Prism.getInstance();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const roles = await TenantActions.getUserTenantRoles(userId) as any[];
                const tenantId = preferredTenantId(Array.isArray(roles) ? roles : []);

                if (tenantId && !await welcomeNoteExistsForUser(prism, userId, tenantId)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await createNote({ ...getWelcomeNoteContent(), userId } as any, tenantId);
                    // Note: onboardingComplete is set by the bot via bot_onboarding_complete tool, not here
                    log.info(`Created welcome note for user ${userId} in tenant ${tenantId}`);
                } else if (!tenantId) {
                    log.warn(`Skipping welcome note creation for user ${userId}: No tenant found`);
                }
                // Note: We don't set onboardingComplete here - that's handled by the bot
            }
        } catch (error) {
            // Log error but don't fail the profile creation request
            log.error('Failed to create welcome note', { error });
        }
    }

    return response;
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
    return PUT_impl(req, interfaceAuthOptions);
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
    return PATCH_impl(req, interfaceAuthOptions);
}
