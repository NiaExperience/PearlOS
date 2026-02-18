
import { NextRequest, NextResponse } from 'next/server';

/**
 * @deprecated This endpoint is no longer used. Prompt composition is handled by pipecat-daily-bot.
 * Use the assistant record directly from the database instead.
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
    return new NextResponse(
        JSON.stringify({ 
            error: 'This endpoint is deprecated. Prompt composition is handled by pipecat-daily-bot.',
            deprecated: true 
        }),
        { status: 410, headers: { 'content-type': 'application/json' } }
    );
}
