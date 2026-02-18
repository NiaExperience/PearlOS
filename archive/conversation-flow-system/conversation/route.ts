/**
 * Conversational HTML Generation API
 * 
 * Handles the multi-step conversational flow for applet creation,
 * modification, and search through voice/chat interface (Pipecat bot).
 * 
 * Features:
 * - Mandatory name confirmation with timeouts
 * - Automatic modification detection
 * - Smart versioning decisions
 * - Search with version selection
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { 
  getConversationFlowManager,
  detectModificationIntent,
  analyzeUserIntent
} from '../../lib/conversation-flow-manager';
import { 
  createEnhancedApplet, 
  searchEnhancedApplets,
  modifyEnhancedApplet
} from '../../actions/enhanced-applet-actions';
import { 
  ConversationAction,
  CreateHtmlGenerationRequest
} from '../../types/html-generation-types';

/**
 * POST /api/html-generation/conversation
 * 
 * Handle conversational flow steps
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' }, 
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      sessionId,
      action,
      userRequest,
      currentAppletId,
      assistantName
    } = body as {
      sessionId: string;
      action: 'start' | 'provide_name' | 'confirm_suggestion' | 'version_decision' | 'select_version';
      userRequest?: string;
      name?: string;
      confirmed?: boolean;
      choice?: 'original' | 'new_version';
      versionId?: string;
      currentAppletId?: string;
      assistantName?: string;
    };

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: 'sessionId is required' },
        { status: 400 }
      );
    }

    const flowManager = getConversationFlowManager();
    const userId = session.user.id;
    const tenantId = session.user.id; // Using user ID as tenant ID
    
    // Get or create conversation context
    const context = flowManager.getOrCreateContext(
      sessionId,
      userId,
      tenantId,
      assistantName
    );

    console.log(`🎯 Conversation API: sessionId=${sessionId}, action=${action}, flowState=${context.flowState}`);

    // Handle different actions
    switch (action) {
      case 'start': {
        if (!userRequest) {
          return NextResponse.json(
            { success: false, message: 'userRequest is required for start action' },
            { status: 400 }
          );
        }

        // Analyze user intent
        const intent = analyzeUserIntent(userRequest);
        console.log(`🧠 Detected intent: ${intent}`);

        // Check for modification intent
        const modificationDetection = detectModificationIntent(userRequest, currentAppletId);
        
        if (modificationDetection.isModification && modificationDetection.confidence > 0.6) {
          console.log(`✏️ Modification detected with confidence ${modificationDetection.confidence}`);
          
          // Dispatch modification detection
          flowManager.dispatch(sessionId, {
            type: 'DETECT_MODIFICATION',
            request: userRequest,
            currentAppletId: currentAppletId || ''
          });

          return NextResponse.json({
            success: true,
            flowState: 'modification_detected',
            aiResponse: {
              message: `I'll modify the current applet with your requested changes: "${userRequest}"`,
              requiresConfirmation: false, // Auto-proceed with modifications
              action: 'start_modification'
            },
            context: flowManager.getContext(sessionId)
          });
        }

        // Check for search/open intent
        if (intent === 'search') {
          console.log(`🔍 Search intent detected`);
          
          // Dispatch search start
          flowManager.dispatch(sessionId, {
            type: 'START_SEARCH',
            query: userRequest
          });

          // Perform search
          const searchResults = await searchEnhancedApplets({
            query: userRequest,
            userId,
            assistantName,
            limit: 10
          });

          console.log(`📋 Search found ${searchResults.results.length} results`);

          // Check if version selection is needed
          if (searchResults.versionPrompt) {
            return NextResponse.json({
              success: true,
              flowState: 'awaiting_version_selection',
              aiResponse: {
                message: searchResults.versionPrompt,
                requiresVersionSelection: true,
                versionOptions: searchResults.versionOptions
              },
              searchResults,
              context: flowManager.getContext(sessionId)
            });
          }

          // Auto-open latest version
          if (searchResults.results.length > 0) {
            const latestApplet = searchResults.results[0].applet;
            
            flowManager.dispatch(sessionId, {
              type: 'GENERATION_COMPLETE',
              result: latestApplet
            });

            return NextResponse.json({
              success: true,
              flowState: 'generation_complete',
              aiResponse: {
                message: `Here's your ${latestApplet.title}`,
                action: 'open_applet',
                applet: latestApplet
              },
              context: flowManager.getContext(sessionId)
            });
          }

          // No results found
          return NextResponse.json({
            success: true,
            flowState: 'idle',
            aiResponse: {
              message: `I couldn't find any applets matching "${userRequest}". Would you like me to create a new one?`,
              requiresConfirmation: true
            },
            context: flowManager.getContext(sessionId)
          });
        }

        // Creation flow - start with name request
        flowManager.dispatch(sessionId, {
          type: 'START_FLOW',
          request: userRequest,
          intent: 'create'
        });

        // Request name (this will trigger timeout automatically in flow manager)
        flowManager.dispatch(sessionId, {
          type: 'REQUEST_NAME'
        });

        return NextResponse.json({
          success: true,
          flowState: 'awaiting_name_response',
          aiResponse: {
            message: 'What would you like to name this app?',
            requiresNameInput: true,
            timeout: {
              duration: 10000, // 10 seconds
              action: 'suggest_name'
            }
          },
          context: flowManager.getContext(sessionId)
        });
      }

      case 'provide_name': {
        const { name } = body as { name: string };
        
        if (!name) {
          return NextResponse.json(
            { success: false, message: 'name is required' },
            { status: 400 }
          );
        }

        console.log(`📝 User provided name: ${name}`);

        // Update context with provided name
        flowManager.dispatch(sessionId, {
          type: 'NAME_PROVIDED',
          name
        });

        // Start generation
        const creationRequest: CreateHtmlGenerationRequest = {
          title: name,
          userProvidedName: name,
          description: context.originalRequest || '',
          userRequest: context.originalRequest || '',
          contentType: 'app', // Default, could be extracted from request
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-20250514',
          assistantName
        };

        flowManager.dispatch(sessionId, {
          type: 'START_GENERATION',
          request: creationRequest
        });

        // Trigger actual generation (async)
        createEnhancedApplet(creationRequest)
          .then(result => {
            if (result.success && result.data) {
              flowManager.dispatch(sessionId, {
                type: 'GENERATION_COMPLETE',
                result: result.data
              });
            }
          })
          .catch(error => {
            console.error('Generation failed:', error);
            flowManager.dispatch(sessionId, {
              type: 'ERROR',
              error: error.message
            });
          });

        return NextResponse.json({
          success: true,
          flowState: 'generating',
          aiResponse: {
            message: `I'll go ahead and create it.`,
            action: 'start_generation',
            showProgress: true
          },
          context: flowManager.getContext(sessionId)
        });
      }

      case 'confirm_suggestion': {
        const { confirmed } = body as { confirmed: boolean };

        console.log(`🤔 User ${confirmed ? 'confirmed' : 'rejected'} suggested name`);

        flowManager.dispatch(sessionId, {
          type: 'CONFIRM_SUGGESTED_NAME',
          confirmed
        });

        if (confirmed) {
          const finalizedName = flowManager.getFinalizedName(sessionId);
          
          if (finalizedName) {
            // Start generation with suggested name
            const creationRequest: CreateHtmlGenerationRequest = {
              title: finalizedName,
              description: context.originalRequest || '',
              userRequest: context.originalRequest || '',
              contentType: 'app',
              aiProvider: 'anthropic',
              aiModel: 'claude-sonnet-4-20250514',
              assistantName
            };

            flowManager.dispatch(sessionId, {
              type: 'START_GENERATION',
              request: creationRequest
            });

            // Trigger actual generation
            createEnhancedApplet(creationRequest)
              .then(result => {
                if (result.success && result.data) {
                  flowManager.dispatch(sessionId, {
                    type: 'GENERATION_COMPLETE',
                    result: result.data
                  });
                }
              })
              .catch(error => {
                console.error('Generation failed:', error);
                flowManager.dispatch(sessionId, {
                  type: 'ERROR',
                  error: error.message
                });
              });

            return NextResponse.json({
              success: true,
              flowState: 'generating',
              aiResponse: {
                message: `Sure, I'll go ahead and create it.`,
                action: 'start_generation',
                showProgress: true
              },
              context: flowManager.getContext(sessionId)
            });
          }
        } else {
          // User rejected suggestion, ask again
          return NextResponse.json({
            success: true,
            flowState: 'requesting_name',
            aiResponse: {
              message: 'No problem! What would you like to name it?',
              requiresNameInput: true
            },
            context: flowManager.getContext(sessionId)
          });
        }
        break;
      }

      case 'version_decision': {
        const { choice } = body as { choice: 'original' | 'new_version' };

        if (!choice) {
          return NextResponse.json(
            { success: false, message: 'choice is required' },
            { status: 400 }
          );
        }

        console.log(`🔢 User chose versioning option: ${choice}`);

        flowManager.dispatch(sessionId, {
          type: 'VERSION_DECISION',
          choice
        });

        // Continue with modification using the chosen versioning strategy
        if (context.currentApplet && context.modificationState) {
          const modifyRequest = {
            appletId: context.currentApplet.id,
            modificationRequest: context.modificationState.modificationRequest,
            aiProvider: 'anthropic',
            aiModel: 'claude-sonnet-4-20250514',
            assistantName,
            saveChoice: choice
          };

          modifyEnhancedApplet(modifyRequest)
            .then(result => {
              if (result.success && result.data) {
                flowManager.dispatch(sessionId, {
                  type: 'GENERATION_COMPLETE',
                  result: result.data
                });
              }
            })
            .catch(error => {
              console.error('Modification failed:', error);
              flowManager.dispatch(sessionId, {
                type: 'ERROR',
                error: error.message
              });
            });

          return NextResponse.json({
            success: true,
            flowState: 'generating',
            aiResponse: {
              message: choice === 'original' 
                ? 'I\'ll save the changes to the original applet.'
                : 'I\'ll create a new version with your changes.',
              action: 'start_modification',
              showProgress: true
            },
            context: flowManager.getContext(sessionId)
          });
        }
        break;
      }

      case 'select_version': {
        const { versionId } = body as { versionId: string };

        if (!versionId) {
          return NextResponse.json(
            { success: false, message: 'versionId is required' },
            { status: 400 }
          );
        }

        console.log(`📌 User selected version: ${versionId}`);

        flowManager.dispatch(sessionId, {
          type: 'SELECT_VERSION',
          versionId
        });

        // Find and return the selected applet
        // This would typically involve fetching the applet by ID
        // For now, return success
        return NextResponse.json({
          success: true,
          flowState: 'generation_complete',
          aiResponse: {
            message: 'Opening the selected version...',
            action: 'open_applet',
            appletId: versionId
          },
          context: flowManager.getContext(sessionId)
        });
      }

      default:
        return NextResponse.json(
          { success: false, message: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    // Fallback response
    return NextResponse.json({
      success: true,
      context: flowManager.getContext(sessionId)
    });

  } catch (error) {
    console.error('Conversation API error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/html-generation/conversation?sessionId=xxx
 * 
 * Get current conversation state
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: 'sessionId is required' },
        { status: 400 }
      );
    }

    const flowManager = getConversationFlowManager();
    const context = flowManager.getContext(sessionId);

    if (!context) {
      return NextResponse.json(
        { success: false, message: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      context
    });

  } catch (error) {
    console.error('Get conversation state error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

