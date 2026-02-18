import { interfaceAuthOptions } from "@interface/lib/auth-config";
import { getLogger } from "@interface/lib/logger";
export const dynamic = "force-dynamic";
import { getSessionSafely, requireAuth } from "@nia/prism/core/auth";
import { UserActions } from "@nia/prism/core/actions";
import { NextRequest, NextResponse } from "next/server";

const log = getLogger('[api_check]');

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    log.info('POST /api/check request received');

    // Check access FIRST - before any input validation
    const authError = await requireAuth(req, interfaceAuthOptions);
    if (authError) {
      log.warn('Access denied');
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!session || !session.user) {
      log.warn('Unauthorized - no valid session');
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse the request body AFTER authentication
    const body = await req.json();
    
    // Extract the parameters
    const userName = body.name || body.message?.function?.arguments?.name || null;
    if (!userName) {
      log.warn('Missing name parameter');
      return NextResponse.json(
        { error: "User name is required" },
        { status: 400 }
      );
    }
   
    log.info('Name parameter received', { userName });

    // Find the user using Prism actions
    const user = await UserActions.getUserByName(userName);

    if (!user) {
      log.warn('User does not exist. Please register first.', { userName });
      return NextResponse.json(
        {
          result: 'User does not exist. Please register first.',
        },
        {
          status: 400,
        }
      );
    }

    log.info('User found', { userName });
    return NextResponse.json({
      result: user,
    });
  } catch (error) {
    log.error('Error processing POST request', { error });
    return NextResponse.json(
      { result: 'Internal Server Error' },
      {
        status: 500,
      }
    );
  }
}
