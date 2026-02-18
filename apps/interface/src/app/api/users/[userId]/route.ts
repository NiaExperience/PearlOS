import { NextRequest, NextResponse } from 'next/server';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { GET_impl, DELETE_impl } from '@nia/prism/core/routes/users/[userId]/route';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
    const userId = req.nextUrl.pathname.split('/').pop() || '';
    return GET_impl(req, { params: { userId } }, interfaceAuthOptions);
}

export async function DELETE(req: NextRequest, context: { params: { userId: string } }): Promise<NextResponse> {
    return DELETE_impl(req, context, interfaceAuthOptions);
}
