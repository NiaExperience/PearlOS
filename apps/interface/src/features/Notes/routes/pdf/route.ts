import { AssistantActions } from '@nia/prism/core/actions';
import { NextRequest, NextResponse } from 'next/server';

import { createNoteAsUser } from '@interface/features/Notes';
import { getLogger } from '@interface/lib/logger';
import { getNotesSession } from '../notes-auth';

const log = getLogger('Notes');

/**
 * POST /api/notes/pdf
 * 
 * Processes a PDF file and creates a new note with the extracted text content.
 * This endpoint handles the server-side creation of notes from PDF content
 * that has been processed on the client side.
 */
export async function POST_impl(request: NextRequest): Promise<NextResponse> {
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

    try {
        const body = await request.json();
        const { 
            title, 
            content, 
            mode, 
            sourceFile 
        } = body;

        if (!title || !content || !mode || !session.user.id || !tenantId) {
            log.error('Missing required fields for PDF note', { 
                titlePresent: !!title, 
                contentPresent: !!content, 
                modePresent: !!mode, 
                userIdPresent: !!session.user.id, 
                tenantIdPresent: !!tenantId 
            });
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Validate sourceFile if provided
        if (sourceFile && (!sourceFile.name || !sourceFile.size || !sourceFile.type)) {
            return NextResponse.json({ 
                error: 'Invalid sourceFile metadata' 
            }, { status: 400 });
        }
        
        const createData = {
            title,
            content,
            mode,
            userId: session.user.id,
            tenantId,
            timestamp: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            sourceFile: sourceFile || undefined
        };

        log.info('Creating note with PDF content', {
            title,
            contentLength: content.length,
            sourceFileName: sourceFile?.name,
            sourceFileSize: sourceFile?.size,
            mode
        });

        const note = await createNoteAsUser(createData, tenantId, session.user.id);
        
        return NextResponse.json(note, { status: 201 });

    } catch (error) {
        const err = error as Error;
        log.error('Failed to create note from PDF', { error: err.message, stack: err.stack });
        return NextResponse.json({ 
            error: 'Failed to create note from PDF', 
            details: err.message 
        }, { status: 500 });
    }
}
