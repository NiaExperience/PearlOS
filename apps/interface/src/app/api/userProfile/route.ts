import { Prism } from '@nia/prism';
import { TenantActions, UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { GET_impl, POST_impl, PUT_impl, PATCH_impl } from '@nia/prism/core/routes/userProfile/route';
import { NextRequest, NextResponse } from 'next/server';

import { NotesDefinition } from '@interface/features/Notes';
import { createNote } from '@interface/features/Notes/actions/notes-actions';
import { getWelcomeNoteContent, WELCOME_NOTE_TITLE } from '@interface/features/Notes/lib/welcome-note';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_user_profile]');

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
                // Check for existing welcome note to prevent duplicates
                // Query by userId only to avoid schema issues
                const prism = await Prism.getInstance();
                const existing = await prism.query({
                    contentType: NotesDefinition.dataModel.block,
                    tenantId: 'any',
                    where: {
                        indexer: { path: 'userId', equals: userId }
                    },
                    limit: 100
                });

                const hasWelcomeNote = existing.items.some((item: any) => item.title === WELCOME_NOTE_TITLE);

                if (!hasWelcomeNote) {
                    // Find a tenant to create the note in
                    // We need to cast to any because getUserTenantRoles return type might be generic
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const roles = await TenantActions.getUserTenantRoles(userId) as any[];
                    const tenantId = roles && roles.length > 0 ? roles[0].tenantId : null;

                    if (tenantId) {
                         // eslint-disable-next-line @typescript-eslint/no-explicit-any
                         await createNote({ ...getWelcomeNoteContent(), userId } as any, tenantId);
                         // Note: onboardingComplete is set by the bot via bot_onboarding_complete tool, not here
                         log.info(`Created welcome note for user ${userId} in tenant ${tenantId}`);
                    } else {
                        log.warn(`Skipping welcome note creation for user ${userId}: No tenant found`);
                    }
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
