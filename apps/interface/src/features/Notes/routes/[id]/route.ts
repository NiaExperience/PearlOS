import { AssistantActions } from '@nia/prism/core/actions';
import { getUserSharedResources } from '@nia/prism/core/actions/organization-actions';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { deleteNote, findNoteById, updateNote } from '@interface/features/Notes';
import { getLogger } from '@interface/lib/logger';
import { getNotesSession } from '../notes-auth';

const log = getLogger('Notes');

/**
 * GET /api/notes/[id]
 * Fetch a single note by ID with organization-level access checking
 */
export async function GET_BY_ID_impl(request: NextRequest, { params }: { params: { id: string } }) : Promise<NextResponse> {
    const session = await getNotesSession(request);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const searchParams = new URL(request.url).searchParams;
    const assistantName = searchParams.get('agent');
    let tenantId = searchParams.get('tenantId');
    
    if (!tenantId) {
        const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
        if (!assistant) {
            log.warn('Assistant not found for note request', { assistantName });
            return NextResponse.json({ error: "Assistant not found" }, { status: 404 });
        }
        tenantId = assistant.tenantId;
        log.debug('Fetched tenant ID from assistant', { tenantId, assistantName });
    }

    const id = (await params).id;
    
    if (!id || !tenantId) {
        log.warn('Missing id or tenantId for GET note', { id, tenantId });
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    try {
        const note = await findNoteById(id, tenantId);
        if (!note) {
            log.warn('Note not found', { noteId: id, tenantId });
            return NextResponse.json({ error: 'Note not found' }, { status: 404 });
        }

        log.info('Access check for note', {
            noteId: id,
            noteMode: note.mode,
            noteTenantId: note.tenantId,
            userId: session.user.id,
            requestTenantId: tenantId,
        });

        // Check access: user owns the note OR work note in same tenant OR user has access via organization sharing
        const isOwner = note.userId === session.user.id;
        const isWorkNote = note.mode === 'work';
        const noteTenantId = note.tenantId;
        const isSameTenant = noteTenantId && noteTenantId === tenantId;
        
        log.info('Permission check for note', {
            isOwner,
            isWorkNote,
            isSameTenant,
            noteTenantId,
            requestTenantId: tenantId,
            userId: session.user.id,
        });

        // WORK NOTES: Tenant-scoped access - allow if user is in same tenant
        if (isWorkNote && isSameTenant) {
            log.info('Work note tenant access allowed', {
                userId: session.user.id,
                tenantId,
                noteId: id,
            });
            log.debug('Returning work note', { noteId: id, tenantId, contentLength: note.content?.length || 0 });
            return NextResponse.json([note]);
        }

        // PERSONAL NOTES: Check ownership or organization sharing
        let hasOrgAccess = false;
        
        if (!isOwner) {
            // Check if user has access via organization sharing
            try {
                const sharedResources = await getUserSharedResources(session.user.id, tenantId, 'Notes');
                hasOrgAccess = sharedResources.some(resource => 
                    resource.resourceId === id && 
                    (resource.role === OrganizationRole.OWNER || 
                     resource.role === OrganizationRole.ADMIN || 
                     resource.role === OrganizationRole.MEMBER)
                );
                
                if (hasOrgAccess) {
                    log.info('Organization sharing access granted for note', {
                        userId: session.user.id,
                        noteId: id,
                        tenantId,
                    });
                } else {
                    log.debug('No organization access found for note', { userId: session.user.id, noteId: id });
                }
            } catch (err) {
                log.error('Error checking organization access', { error: err });
            }
        } else {
            log.info('Owner access to note', { userId: session.user.id, noteId: id, tenantId });
        }

        if (!isOwner && !hasOrgAccess) {
            log.warn('Access denied for note', {
                userId: session.user.id,
                noteId: id,
                isOwner,
                hasOrgAccess,
                isWorkNote,
                isSameTenant,
                noteTenantId,
                requestTenantId: tenantId,
            });
            return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }

        log.debug('Returning note', { noteId: id, tenantId, contentLength: note.content?.length || 0 });
        return NextResponse.json([note]);
    } catch (error) {
        log.error('Error fetching note', { error });
        return NextResponse.json({ error: 'Failed to fetch note' }, { status: 500 });
    }
}


export async function PUT_impl(request: NextRequest, { params }: { params: { id: string } }) : Promise<NextResponse> {
    const session = await getNotesSession(request);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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

    const id = (await params).id;
    const { title, content, isPinned } = await request.json();
    if (!title || !content || !session.user.id || !tenantId) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    try {
        const note = await findNoteById(id, tenantId);
        if (!note) {
            log.info('Note not found during PUT', { noteId: id, tenantId });
            return NextResponse.json({ error: 'Note not found' }, { status: 404 });
        }
        // Enforce tenant ownership: note.tenantId must match resolved tenantId
        if (note.tenantId && note.tenantId !== tenantId) {
            return NextResponse.json({ error: 'Forbidden tenant mismatch' }, { status: 403 });
        }
        const updateData = {
            ...note,
            title,
            content,
            isPinned: isPinned !== undefined ? isPinned : note.isPinned,
            userId: session.user.id,
            tenantId,
            // TODO: do we update timestamp for updated note?
            // timestamp: new Date().toISOString()
        }
        await updateNote(id, updateData, tenantId);
        log.info('Note updated via PUT', { noteId: id, tenantId, updateData });
        return NextResponse.json({ message: 'Note updated successfully' }, { status: 200 });
   } catch (error) {
        log.error('Error updating note via PUT', { error });
        return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
    }
}

export async function PATCH_impl(request: NextRequest, { params }: { params: { id: string } }) : Promise<NextResponse> {
    const session = await getNotesSession(request);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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

    const id = (await params).id;
    const { title, content, isPinned } = await request.json();
    if (!session.user.id || !tenantId) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    try {
        // PATCH performs partial update - only send fields that are provided
        const updateData: Record<string, unknown> = {
            userId: session.user.id,
            tenantId,
        };
        
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (isPinned !== undefined) updateData.isPinned = isPinned;
        
        await updateNote(id, updateData, tenantId);
        log.info('Note updated via PATCH', { noteId: id, tenantId, updateData });
        return NextResponse.json({ message: 'Note updated successfully' }, { status: 200 });
   } catch (error) {
        log.error('Error updating note via PATCH', { error });
        return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
    }
}

export async function DELETE_impl(request: NextRequest, { params }: { params: { id: string } }) : Promise<NextResponse> {
    // New: enforce session auth (previously missing)
    const session = await getNotesSession(request);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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

    const id = (await params).id;
    if (!id || !tenantId) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    try {
        const note = await findNoteById(id, tenantId);
        if (!note) {
            log.info('Note not found during DELETE', { noteId: id, tenantId });
            return NextResponse.json({ error: 'Note not found' }, { status: 404 });
        }
        // Enforce tenant ownership: note.tenantId must match resolved tenantId
        if (note.tenantId && note.tenantId !== tenantId) {
            return NextResponse.json({ error: 'Forbidden tenant mismatch' }, { status: 403 });
        }
        const success = await deleteNote(id, tenantId);
        if (!success) {
            return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
        }
        return NextResponse.json({ message: 'Note deleted successfully' });
    } catch (error) {
        log.error('Error deleting note', { error });
        return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
    }
}