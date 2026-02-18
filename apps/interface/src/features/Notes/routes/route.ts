import { AssistantActions } from '@nia/prism/core/actions';
import { getUserSharedResources as getUserSharedResourcesFromOrg } from '@nia/prism/core/actions/organization-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import { NextRequest, NextResponse } from 'next/server';

import { createNoteAsUser, findNoteById, findNoteByUserAndMode, findNotesByUserAndTitle } from '@interface/features/Notes';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { getNotesSession } from './notes-auth';

const log = getLogger('Notes');

export async function GET_impl(request: NextRequest) : Promise<NextResponse> {
    const session = await getNotesSession(request);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
                const sessionId =
                    'sessionId' in session.user && typeof session.user.sessionId === 'string'
                        ? session.user.sessionId
                        : session.user.id;
                setLogContext({
                        sessionId: sessionId ?? undefined,
                        userId: session.user.id ?? undefined,
                        userName:
                            'name' in session.user && typeof session.user.name === 'string'
                                ? session.user.name
                                : 'email' in session.user && typeof session.user.email === 'string'
                                    ? session.user.email
                                    : undefined,
                        tag: 'Notes',
                });
    const searchParams = new URL(request.url).searchParams;
    const mode = searchParams.get('mode') || 'personal';
    const assistantName = searchParams.get('agent');
    let tenantId = searchParams.get('tenantId');
    if (!tenantId) {
      // Get the assistant by name if tenantId is not provided
      const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
      if (!assistant) {
        return NextResponse.json(
          { error: "Assistant not found" },
          { status: 404 }
        );
      }
      // Get the tenant from the assistant
      tenantId = assistant.tenantId;
            log.info('Fetched tenant ID from assistant', { tenantId, assistantName });
    }

    if (!session.user.id || !tenantId || !mode) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    let normalizedTitle = searchParams.get('title') || undefined;
    if (normalizedTitle) {
        normalizedTitle = normalizedTitle.trim().toLowerCase();
    }

    try {
        log.info('Fetching notes for user', { userId: session.user.id, tenantId, mode });
        
        // Fetch user's own notes
        let notes = await findNoteByUserAndMode(session.user.id, tenantId, mode);
        if (!notes && normalizedTitle) {
            notes = await findNotesByUserAndTitle(session.user.id, tenantId, normalizedTitle) || [];
        }
        
        // Also fetch shared notes from organizations (only for personal mode)
        if (mode === 'personal') {
            try {
                const sharedResources = await getUserSharedResourcesFromOrg(session.user.id, tenantId, 'Notes');
                log.info('Found shared note resources', {
                    count: sharedResources.length,
                    userId: session.user.id,
                    tenantId,
                });
                
                // Fetch the actual note content for each shared resource
                const sharedNotes = await Promise.all(
                    sharedResources.map(async (resource) => {
                        try {
                            const note = await findNoteById(resource.resourceId, tenantId);
                            if (note) {
                                // Fetch owner's details to display in SharedByBadge
                                let ownerDisplayName = note.userId; // fallback to userId
                                try {
                                    const owner = await getUserById(note.userId);
                                    // Prefer name over email for display
                                    if (owner?.name) {
                                        ownerDisplayName = owner.name;
                                    } else if (owner?.email) {
                                        ownerDisplayName = owner.email;
                                    }
                                } catch (userError) {
                                    log.error('Error fetching owner details for shared note', {
                                        noteId: note._id,
                                        error: userError,
                                    });
                                }
                                
                                // Add metadata to indicate this is a shared note
                                return {
                                    ...note,
                                    sharedVia: {
                                        organization: resource.organization,
                                        role: resource.role,
                                        ownerEmail: ownerDisplayName, // Add owner's name/email for display
                                    },
                                };
                            }
                            return null;
                        } catch (err) {
                            log.error('Error fetching shared note', {
                                resourceId: resource.resourceId,
                                error: err,
                            });
                            return null;
                        }
                    })
                );
                
                // Filter out nulls and add to notes array
                const validSharedNotes = sharedNotes.filter(note => note !== null);
                notes = [...(notes || []), ...validSharedNotes];
            } catch (sharedError) {
                log.error('Error fetching shared notes', { error: sharedError });
                // Continue with just personal notes
            }
        }
        
        // Deduplicate by _id
        if (notes) {
            const seenIds = new Set<string>();
            const uniqueNotes = notes.filter(note => {
                if (seenIds.has(note._id!)) {
                    return false;
                }
                seenIds.add(note._id!);
                return true;
            });
            notes = uniqueNotes;            
        }

        if (!notes || notes.length === 0) {
            log.info('No notes found for user', { userId: session.user.id, tenantId, mode });
            return NextResponse.json([]);
        }
        log.info('Fetched notes successfully', { count: notes.length, userId: session.user.id, tenantId, mode });
        return NextResponse.json(notes);
    } catch (error) {
        log.error('Error fetching notes', { error, userId: session.user.id, tenantId, mode });
        return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
    }
}

export async function POST_impl(request: NextRequest) : Promise<NextResponse> {
    const session = await getNotesSession(request);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
                const sessionId =
                    'sessionId' in session.user && typeof session.user.sessionId === 'string'
                        ? session.user.sessionId
                        : session.user.id;
                setLogContext({
                        sessionId: sessionId ?? undefined,
                        userId: session.user.id ?? undefined,
                        userName:
                            'name' in session.user && typeof session.user.name === 'string'
                                ? session.user.name
                                : 'email' in session.user && typeof session.user.email === 'string'
                                    ? session.user.email
                                    : undefined,
                        tag: 'Notes',
                });
    const searchParams = new URL(request.url).searchParams;
    const assistantName = searchParams.get('agent');
    let tenantId = searchParams.get('tenantId');
    if (!tenantId) {
      // Get the assistant by name if tenantId is not provided
      const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
      if (!assistant) {
        return NextResponse.json(
          { error: "Assistant not found" },
          { status: 404 }
        );
      }
      // Get the tenant from the assistant
      tenantId = assistant.tenantId;
            log.info('Fetched tenant ID from assistant', { tenantId, assistantName });
    }
    const { title, content, mode } = await request.json()
    if (!title || !content || !mode || !session.user.id || !tenantId) {
                log.error('Missing required fields when creating note', {
                        title,
                        contentLength: content?.length,
                        mode,
                        userId: session.user.id,
                        tenantId,
                });
        return NextResponse.json({ error: 'Missing required fields'}, { status: 400 });
    }
    try {
          const createData = {
            title,
            content,
            mode,
            userId: session.user.id,
            tenantId,
            timestamp: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        // Do not log note content (may contain PII/secrets). Log only metadata.
        log.info('Creating note', {
            title,
            contentLength: typeof content === 'string' ? content.length : undefined,
            mode,
            userId: session.user.id,
            tenantId,
        });
        const note = await createNoteAsUser(createData, tenantId, session.user.id);
        return NextResponse.json(note, { status: 201 });
    } catch (error) {
        const err = error as Error;
        log.error('Failed to create note', { message: err.message, stack: err.stack });
        return NextResponse.json({ error: 'Failed to create note', details: err.message }, { status: 500 });
    }
}