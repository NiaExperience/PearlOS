import { Prism } from '@nia/prism';
import { getAssistantBySubDomain, getAssistantByName } from '@nia/prism/core/actions/assistant-actions';
import { getTenantsForUser } from '@nia/prism/core/actions/tenant-actions';
import * as UserProfileActions from '@nia/prism/core/actions/userProfile-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { NotesDefinition } from '@interface/features/Notes';
import { createNote } from '@interface/features/Notes/actions/notes-actions';
import { getWelcomeNoteContent, WELCOME_NOTE_TITLE } from '@interface/features/Notes/lib/welcome-note';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('Notes:Welcome');

export async function POST(req: NextRequest) {
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!session || !session.user || !session.user.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    let tenantId = (await req.json())?.tenantId as string | undefined;

    try {
        if (!tenantId) {
            log.warn('No tenantId provided in request', { userId });

            // 1. Find the correct tenant for the current assistant context
            tenantId = await resolveTenantFromRequest(req, userId);

            if (!tenantId) {
                log.warn('No tenant found for user', { userId });
                return NextResponse.json({ error: 'No tenant found' }, { status: 400 });
            }
        }
        const prism = await Prism.getInstance();
        
        // 2. Check if welcome note already exists
        // Query by parent and title using indexer path (title is stored in indexer JSONB)
        const existing = await prism.query({
            contentType: NotesDefinition.dataModel.block,
            where: {
                AND: [
                    { parent_id: { eq: userId } },
                    { indexer: { path: 'title', equals: WELCOME_NOTE_TITLE } }
                ]
            },
            limit: 1, // Fetch enough to check titles
            tenantId
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasWelcomeNote = existing.items.some((item: any) => item.title === WELCOME_NOTE_TITLE);

        if (hasWelcomeNote) {
            log.info('Welcome note already exists', { userId });
            // Note: onboardingComplete is set by the bot via bot_onboarding_complete tool, not here
            return NextResponse.json({ success: true, message: 'Already exists' });
        }

        // 3. Create the welcome note
        const noteContent = getWelcomeNoteContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const note = await createNote({ ...noteContent, userId } as any, tenantId );
        log.info('Created welcome note', { userId, noteId: note._id });
        return NextResponse.json({ success: true, note });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        log.error('Failed to create welcome note', { userId, error: error.message });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

async function resolveTenantFromRequest(req: NextRequest, userId: string): Promise<string | undefined> {
    // Try to resolve assistant from Referer
    const referer = req.headers.get('referer');
    if (referer) {
        try {
            const url = new URL(referer);
            const host = url.hostname;
            let assistantIdentifier: string | null = null;

            // Check for subdomain (e.g. nia.domain.com)
            // Exclude localhost/IPs unless they have subdomains (e.g. nia.localhost)
            const parts = host.split('.');
            if (parts.length > 2 || (parts.length === 2 && parts[1] === 'localhost')) {
                assistantIdentifier = parts[0];
            } else if (host.includes('localhost') || host.includes('127.0.0.1')) {
                // Path-based routing on localhost (e.g. localhost:3000/nia/...)
                const pathSegments = url.pathname.split('/').filter(Boolean);
                if (pathSegments.length > 0) {
                    assistantIdentifier = pathSegments[0];
                }
            }

            if (assistantIdentifier) {
                const normalizedName = assistantIdentifier.charAt(0).toUpperCase() + assistantIdentifier.slice(1).toLowerCase();
                const assistant = await getAssistantBySubDomain(assistantIdentifier) || await getAssistantByName(normalizedName);
                
                if (assistant && assistant.tenantId) {
                    log.info('Resolved tenant from assistant context', { userId, assistant: assistantIdentifier, tenantId: assistant.tenantId });
                    return assistant.tenantId;
                }
            }
        } catch (e) {
            log.warn('Failed to parse referer for assistant context', { referer, error: e });
        }
    }

    // Fallback to first available tenant if context resolution failed
    const tenants = await getTenantsForUser(userId);
    if (!tenants || tenants.length === 0) {
        return undefined;
    }
    
    log.warn('Falling back to first available tenant', { userId, tenantId: tenants[0]._id });
    return tenants[0]._id;
}
