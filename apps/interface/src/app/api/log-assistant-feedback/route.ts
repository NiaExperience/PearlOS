
import { AssistantActions } from "@nia/prism/core/actions";
import { getSessionSafely } from "@nia/prism/core/auth";
import * as AssistantFeedbackBlock from "@nia/prism/core/blocks/assistantFeedback.block";
import { NextRequest, NextResponse } from "next/server";

import { interfaceAuthOptions } from "@interface/lib/auth-config";
import { getLogger } from "@interface/lib/logger";

export const dynamic = "force-dynamic";

const log = getLogger('[api_assistant_feedback]');

// POST method for function calls
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Check session FIRST - before any input validation
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!session || !session.user) {
      log.warn('Unauthorized - no valid session');
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.is_anonymous) {
      log.info('Anonymous access OK');
    }
    
    // Parse the request body AFTER authentication
    const body = await req.json();
    
    // Extract the parameters
    const description = body.description || body.message?.function?.arguments?.description;
    const callId = body.callId || body.message?.function?.arguments?.callId;
    const assistantSubdomain = body.agent || body.assistant || body.message?.function?.arguments?.assistant || null;
    const assistantId = body.assistant_id || body.message?.function?.arguments?.assistantId || null;
    
    log.info('Feedback request received', { assistantSubdomain, assistantId });

    if (!assistantId && !assistantSubdomain) {
      log.warn('Missing agent (or assistant_id) parameter');
      return NextResponse.json(
        { error: "Assistant agent is required" },
        { status: 400 }
      );
    }

    if (!description) {
      log.warn('Missing description parameter');
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    if (!callId) {
      log.warn('Missing callId parameter');
      return NextResponse.json(
        { error: "callId is required" },
        { status: 400 }
      );
    }

    // Get assistant
    const assistant = await AssistantActions.getValidatedAssistant(assistantId, assistantSubdomain) || null;
    if (!assistant || !assistant._id) {
      log.warn('Assistant not found', { assistantId, assistantSubdomain });
      return NextResponse.json({ error: 'Assistant not found' }, { status: 404 });
    }

    // Clean up the callId (remove extra quotes)
    const cleanCallId = callId.replace(/['"]+/g, '');

    const feedbackData : AssistantFeedbackBlock.IAssistantFeedback = {
      assistant_id: assistant._id as string,
      call_id: cleanCallId,
      description,
      feedback_type: AssistantFeedbackBlock.FeedbackType.MISTAKE,
      reported_at: new Date().toISOString(),
    }

    // Use Prism actions to create feedback (add createFeedback if needed)
    const feedback = await AssistantActions.createFeedback(feedbackData);
    
    log.info('Feedback logged successfully', { assistantId: assistant._id, callId: cleanCallId });

    return NextResponse.json(
      { 
      success: true,
      message: 'Feedback logged successfully',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: (feedback as any).items?.[0] || feedback
      }
    );
  } catch (error) {
    log.error('Error in feedback logging', { error });
    return NextResponse.json(
      { error: "An error occurred while processing the request" },
      { status: 500 }
    );
  }
}