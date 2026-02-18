import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { TenantActions } from "@nia/prism/core/actions";
import { getSessionSafely } from "@nia/prism/core/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const disableAuth =
      process.env.DISABLE_DASHBOARD_AUTH === 'true' &&
      (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1');

    if (disableAuth) {
      // Local dev: treat caller as an owner so admin UI works.
      return NextResponse.json({
        roles: [{ tenantId: 'local-dev', role: 'owner' }],
        userId: 'local-dev-admin',
      });
    }

    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user || session.user.is_anonymous) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const roles = await TenantActions.getUserTenantRoles(session.user.id);
    
    return NextResponse.json({ 
      roles: roles || [],
      userId: session.user.id 
    });
  } catch (error) {
    console.error('Error fetching user tenant roles:', error);
    return NextResponse.json({ error: "Failed to fetch tenant roles" }, { status: 500 });
  }
} 