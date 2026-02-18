import { GlobalSettingsActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { isSuperAdmin } from '@nia/prism/core/auth/auth.middleware';
import { InterfaceLoginSettings } from '@nia/features';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { LOGIN_FEATURE_KEYS } from '@dashboard/lib/feature-normalization';

// Type for the update payload - matches what GlobalSettingsActions.upsertGlobalSettings expects
interface UpdatePayload {
  interfaceLogin?: Partial<InterfaceLoginSettings>;
  denyListEmails?: string[];
}

export const dynamic = 'force-dynamic';

async function requireSuperAdmin(req: NextRequest) {
  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id || !isSuperAdmin(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireSuperAdmin(req);
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const settings = await GlobalSettingsActions.getGlobalSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[GlobalSettings][GET] Failed to load settings', error);
    return NextResponse.json({ error: 'Failed to load global settings' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireSuperAdmin(req);
  if (session instanceof NextResponse) {
    return session;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const updates: UpdatePayload = {};

  // Handle interfaceLogin updates
  const interfaceLogin = payload.interfaceLogin;
  if (interfaceLogin && typeof interfaceLogin === 'object') {
    updates.interfaceLogin = {};
    for (const key of LOGIN_FEATURE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(interfaceLogin, key)) {
        const value = (interfaceLogin as Record<string, unknown>)[key];
        if (typeof value !== 'boolean') {
          return NextResponse.json({ error: `Value for ${key} must be boolean` }, { status: 400 });
        }
        (updates.interfaceLogin as Record<string, boolean>)[key] = value;
      }
    }
  }

  // Handle denyListEmails updates
  if (Object.prototype.hasOwnProperty.call(payload, 'denyListEmails')) {
    const denyListEmails = payload.denyListEmails;
    if (!Array.isArray(denyListEmails)) {
      return NextResponse.json({ error: 'denyListEmails must be an array' }, { status: 400 });
    }
    // Validate each email is a string
    for (const email of denyListEmails) {
      if (typeof email !== 'string') {
        return NextResponse.json({ error: 'Each email in denyListEmails must be a string' }, { status: 400 });
      }
    }
    updates.denyListEmails = denyListEmails;
  }

  // Require at least one update
  const hasInterfaceLoginUpdates = updates.interfaceLogin && Object.keys(updates.interfaceLogin).length > 0;
  const hasDenyListUpdates = updates.denyListEmails !== undefined;
  if (!hasInterfaceLoginUpdates && !hasDenyListUpdates) {
    return NextResponse.json({ error: 'No recognized updates provided' }, { status: 400 });
  }

  try {
    // Use type assertion to indicate we're using the new UpdateGlobalSettingsInput shape
    const settings = await GlobalSettingsActions.upsertGlobalSettings(updates as Parameters<typeof GlobalSettingsActions.upsertGlobalSettings>[0]);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[GlobalSettings][PATCH] Failed to update settings', error);
    return NextResponse.json({ error: 'Failed to update global settings' }, { status: 500 });
  }
}
