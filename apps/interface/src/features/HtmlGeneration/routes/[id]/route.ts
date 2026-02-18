import { AssistantActions } from '@nia/prism/core/actions';
import { getAssistantByName } from '@nia/prism/core/actions/assistant-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { modifyEnhancedApplet } from '@interface/features/HtmlGeneration/actions/enhanced-applet-actions';
import { 
  getHtmlGeneration, 
  updateHtmlContent, 
  deleteHtmlContent 
} from '@interface/features/HtmlGeneration/actions/html-generation-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[html-generation.id-route]');

/**
 * Resolves tenantId from assistantName for route handlers.
 * This mirrors the logic in enhanced-applet-actions.ts.
 */
async function resolveAssistantTenantId(assistantName: string | undefined): Promise<string> {
  if (!assistantName) {
    throw new Error('assistantName is required to determine tenantId');
  }
  let assistant = await getAssistantByName(assistantName);
  if (!assistant) {
    try {
      assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
    } catch (_) {
      // no-op
    }
  }
  if (!assistant) {
    throw new Error(`Assistant not found: ${assistantName}`);
  }
  if (!assistant.tenantId) {
    throw new Error(`Assistant '${assistantName}' has no tenantId configured`);
  }
  return assistant.tenantId;
}

export async function GET_ID_impl(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const htmlContent = await getHtmlGeneration((await params).id);
    
    if (!htmlContent) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'HTML content not found' 
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: htmlContent
    });
  } catch (error) {
    log.error('Error fetching HTML content', { err: error });
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to fetch HTML content',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function PUT_impl(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!session) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const updateData = await request.json();
    const appletId = (await params).id;
    
    // Extract room URL from headers
    const roomUrl = request.headers.get('x-room-url') || request.headers.get('x-daily-room-url') || undefined;

    log.info('PUT_impl: received versioning-aware update request', {
      appletId,
      hasUserRequest: !!updateData.userRequest,
      versioningPreference: updateData.versioningPreference,
      aiProvider: updateData.aiProvider,
      aiModel: updateData.aiModel
    });

    // Check if this is a versioning-aware request (new format)
    if (updateData.userRequest && typeof updateData.userRequest === 'string') {
      // Use the new versioning-aware function
      const modifyRequest = {
        appletId,
        modificationRequest: updateData.userRequest,
        aiProvider: updateData.aiProvider || 'openai',
        aiModel: updateData.aiModel || 'gpt-5',
        assistantName: updateData.assistantName,
        versioningPreference: updateData.versioningPreference || 'modify_existing',
        saveChoice: updateData.saveChoice || 'original', // Add save choice for new 4-step flow
        roomUrl,
      };

      const response = await modifyEnhancedApplet(modifyRequest);
      return NextResponse.json(response);
    } else {
      // Fallback to old function for backward compatibility
      log.info('PUT_impl: using legacy update function', { appletId });
      
      // CRITICAL: tenantId must come from the assistant, NOT the user
      if (!updateData.assistantName) {
        return NextResponse.json(
          { success: false, message: 'assistantName is required' },
          { status: 400 }
        );
      }
      const tenantId = await resolveAssistantTenantId(updateData.assistantName);
      
      // CRITICAL FIX: Add basic version awareness to legacy updates
      if (updateData.title && typeof updateData.title === 'string') {
        log.info('PUT_impl: applying version awareness to title update', { appletId });
        
        try {
          // Import versioning utilities
          const { checkVersionConflicts } = await import('../../lib/versioning-system');
          const { Prism } = await import('@nia/prism');
          const { HtmlGenerationDefinition } = await import('../../definition');
          
          // Get existing applets to check for conflicts
          const prism = await Prism.getInstance();
          const result = await prism.query({
            contentType: HtmlGenerationDefinition.dataModel.block,
            tenantId,
            where: { parent_id: { eq: session.user?.id || '' } },
            limit: 100
          });
          const userApplets = result?.items || [];
          const versionConflicts = checkVersionConflicts(updateData.title, userApplets);
          
          if (versionConflicts.hasConflicts) {
            log.warn('PUT_impl: version conflicts detected in legacy update', {
              proposedTitle: updateData.title,
              suggestedTitle: versionConflicts.suggestedVersionName,
              existingVersions: versionConflicts.existingVersions.length
            });
            
            // Update the title to avoid conflicts
            updateData.title = versionConflicts.suggestedVersionName;
          } else if (!updateData.title.includes(' v')) {
            // Add v1 if no version specified
            updateData.title = versionConflicts.suggestedVersionName;
          }
          
          log.info('PUT_impl: legacy update title versioning applied', { finalTitle: updateData.title });
        } catch (versioningError) {
          log.warn('PUT_impl: version awareness failed, proceeding with original title', {
            error: versioningError instanceof Error ? versioningError.message : String(versioningError)
          });
        }
      }
      
      const updatedContent = await updateHtmlContent(appletId, updateData, tenantId);

      return NextResponse.json({
        success: true,
        message: 'HTML content updated successfully',
        data: updatedContent
      });
    }
  } catch (error) {
    log.error('Error updating HTML content', { err: error });
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to update HTML content',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function DELETE_impl(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!session) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // CRITICAL: tenantId must come from the assistant, NOT the user
    // Get assistantName from query params or body
    const url = new URL(request.url);
    const assistantName = url.searchParams.get('assistantName');
    
    if (!assistantName) {
      return NextResponse.json(
        { success: false, message: 'assistantName query param is required' },
        { status: 400 }
      );
    }
    
    const tenantId = await resolveAssistantTenantId(assistantName);
    const success = await deleteHtmlContent((await params).id, tenantId);

    if (!success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Failed to delete HTML content' 
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'HTML content deleted successfully'
    });
  } catch (error) {
    log.error('Error deleting HTML content', { err: error });
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to delete HTML content',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
