import { NextRequest, NextResponse } from 'next/server';
import { getDiagnostics, clearDiagnostics } from '@interface/features/HtmlGeneration/lib/diagnostics';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

export async function GET(request: NextRequest) {
  const session = await getSessionSafely(request, interfaceAuthOptions);
  if (!session || !session.user) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const opId = request.nextUrl.searchParams.get('opId') || undefined;
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam))) : 25;
  const entries = getDiagnostics(opId || undefined, limit);
  return NextResponse.json({ success: true, data: entries });
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionSafely(request, interfaceAuthOptions);
  if (!session || !session.user) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const opId = request.nextUrl.searchParams.get('opId') || undefined;
  clearDiagnostics(opId || undefined);
  return NextResponse.json({ success: true });
}
