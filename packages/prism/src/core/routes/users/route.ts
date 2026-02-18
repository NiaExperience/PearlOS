import { AssistantActions, TenantActions, UserActions } from '@nia/prism/core/actions';
import { getSessionSafely, requireTenantAdmin } from '@nia/prism/core/auth';
import { isSuperAdmin } from '@nia/prism/core/auth/auth.middleware';
import { IUser } from '@nia/prism/core/blocks/user.block';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextAuthOptions } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../logger';

const log = getLogger('prism:routes:users');

/**
 * API route to get users for a tenant
 * GET /api/users?tenantId=xxx
 *
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with users for the tenant
 */
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
    log.info('Users GET');
    let tenantId = req.nextUrl.searchParams.get("tenantId") as string;
    if (!tenantId) {
        const assistantName = req.nextUrl.searchParams.get("agent") as string;
        if (assistantName) {
            const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
            if (assistant) {
                tenantId = assistant.tenantId;
            } else {
                return NextResponse.json({ error: `Agent ${assistantName} not found` }, { status: 404 });
            }
        } else {
            return NextResponse.json({ error: "Agent or Tenant ID is required" }, { status: 400 });
        }
    }
    log.info('Users GET tenant resolved', { tenantId });
    const users: IUser[] = [];
    try {
        // Get users for the tenant
        const foundUsers = await TenantActions.getUsersForTenant(tenantId);
        if (foundUsers && foundUsers.length > 0) {
            users.push(...foundUsers);
        }
    } catch (error: any) {
        log.error('Error getting users for tenant', { error, tenantId });
        return NextResponse.json(
            { error: error.message || 'Failed to get users for tenant' },
            { status: 500 }
        );
    }
    log.info('Users GET returning', { tenantId, count: users.length });
    return NextResponse.json(users);
}

/**
 * API route to create or update a user for a tenant
 * POST /api/users
 *
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with the created or updated user
 */
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
    log.info('Users POST');

    // Check authentication
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Parse the request body (defensively handle empty or malformed JSON)
        let raw = '';
        try {
            raw = await req.text();
        } catch (e: any) {
            log.warn('POST /api/users failed reading raw body', { error: e?.message });
        }

        if (!raw || raw.trim() === '') {
            log.warn('POST /api/users empty request body');
            return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
        }

        let data: any;
        try {
            data = JSON.parse(raw);
        } catch (e: any) {
            log.error('POST /api/users JSON parse error', { error: e?.message, rawSnippet: raw.slice(0, 200) });
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        // Handle both formats:
        // 1. { tenantId, userData } - New format
        // 2. { name, email, password, tenantId, role } - Old format (from tests)
        let tenantId: string;
        let userData: any;
        let userRole: TenantRole | undefined = undefined;

        if (data.tenantId && data.userData) {
            // New format
            tenantId = data.tenantId;
            userData = data.userData;
        } else if (data.tenantId && data.name && data.email) {
            // Old format (from tests)
            tenantId = data.tenantId;
            // Extract user data fields, exclude tenantId and role
            const { tenantId: _, role, ...userFields } = data;
            userData = userFields;
            // Store role separately
            userRole = data.role;
        } else if (isSuperAdmin(session.user.id) && data.name && data.email) {
            // Superadmin global user creation (no tenant assignment)
            tenantId = '' as any; // sentinel; skip tenant role assignment later
            userData = { name: data.name, email: data.email, password: data.password };
            userRole = data.role;
        } else {
            return NextResponse.json({ error: "Invalid request format" }, { status: 400 });
        }

        // For non-global create require tenant
        if (!tenantId && !isSuperAdmin(session.user.id)) {
            return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
        }

        if (!userData) {
            return NextResponse.json({ error: "User data is required" }, { status: 400 });
        }

        // Check tenant admin access
        if (tenantId) {
            const authError = await requireTenantAdmin(tenantId, req, authOptions);
            if (authError) {
                log.warn('Users POST access denied', { tenantId, userId: session.user.id });
                return NextResponse.json({ error: "Access denied" }, { status: 403 });
            }
        } else if (!isSuperAdmin(session.user.id)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        // Based on the userRole, determine if we need to create a user or update an existing one
        let result;
        userRole = userRole ?? TenantRole.MEMBER;

        if (userData._id) {
            // Update existing user
            result = await UserActions.updateUser(userData._id, userData);
        } else {
            // Create new user
            if (userData.password) {
                result = await UserActions.createUser({
                    ...userData,
                    password: userData.password
                });
            } else {
                result = await UserActions.createUser(userData);
            }

            // Assign user to tenant with specified role
            if (result && result._id && tenantId) {
                await TenantActions.assignUserToTenant(result._id, tenantId, userRole);
            }
        }

        // Sanitize the result before returning to remove any sensitive data
        // For new users, return 201 status
        const isNewUser = !userData._id;
        if (isNewUser && result) {
            return NextResponse.json(result, { status: 201 });
        }

        return NextResponse.json(result);
    } catch (error: any) {
        log.error('Error creating/updating user', { error });
        return NextResponse.json(
            { error: error.message || 'Failed to create/update user' },
            { status: 500 }
        );
    }
}
