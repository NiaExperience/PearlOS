import { Prism } from '@nia/prism';
import { getAssistantBySubDomain, getAssistantByName } from '@nia/prism/core/actions/assistant-actions';
import { NextRequest, NextResponse } from 'next/server';

import { createNote } from '@interface/features/Notes/actions/notes-actions';
import { getWelcomeNoteContent } from '@interface/features/Notes/lib/welcome-note';
import { welcomeNoteExistsForUser } from '@interface/features/Notes/lib/welcome-note-exists';
import { getLogger } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('Notes:Welcome');

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const requestedTenantId = body && typeof body === 'object' && !Array.isArray(body)
        ? ((body as Record<string, unknown>).tenantId || (body as Record<string, unknown>).tenant_id)
        : undefined;
    const assistantTenantId = requestedTenantId ? undefined : await resolveTenantFromAssistantContext(req);
    const actorResult = await resolveInterfaceActorContext({
        requestedTenantId: requestedTenantId || assistantTenantId,
    });
    if (!actorResult.ok) return actorResult.response;

    const { userId, tenantId } = actorResult.actor;

    try {
        const prism = await Prism.getInstance();
        
        if (await welcomeNoteExistsForUser(prism, userId, tenantId)) {
            log.info('Welcome note already exists', { userId });
            // Note: onboardingComplete is set by the bot via bot_onboarding_complete tool, not here
            return NextResponse.json({ success: true, message: 'Already exists' });
        }

        // 3. Create the welcome note
        const noteContent = getWelcomeNoteContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const note = await createNote({ ...noteContent, userId } as any, tenantId );
        log.info('Created welcome note', { userId, tenantId, noteId: note._id });
        return NextResponse.json({ success: true, note });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        log.error('Failed to create welcome note', { userId, error: error.message });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

async function resolveTenantFromAssistantContext(req: NextRequest): Promise<string | undefined> {
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
                    log.info('Resolved requested tenant from assistant context', { assistant: assistantIdentifier, tenantId: assistant.tenantId });
                    return assistant.tenantId;
                }
            }
        } catch (e) {
            log.warn('Failed to parse referer for assistant context', { referer, error: e });
        }
    }
    return undefined;
}
