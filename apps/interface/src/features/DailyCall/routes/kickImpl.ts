/**
 * Kick User API Route Implementation
 * 
 * Admin-only endpoint to kick a user from DailyCall and apply a timeout.
 * POST /api/dailyCall/kick
 * 
 * Request body:
 * - targetUserId: string - User ID to kick
 * - targetEmail: string (optional) - User email (required for 'forever' duration)
 * - duration: '5m' | '15m' | '30m' | '60m' | 'forever'
 * - roomUrl: string (optional) - Room URL for room-specific kick
 * - reason: string (optional) - Reason for the kick
 */

import { TenantActions } from '@nia/prism/core/actions';
import { GlobalSettingsActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

import {
  setUserTimeout,
  TIMEOUT_DURATIONS,
  type TimeoutDuration,
} from '../lib/userTimeout';

const log = getLogger('[daily_call:kick]');

export const dynamic = 'force-dynamic';

interface KickRequestBody {
  targetUserId: string;
  targetEmail?: string;
  duration: TimeoutDuration;
  roomUrl?: string;
  reason?: string;
  tenantId?: string;
}

export async function POST_impl(req: NextRequest) {
  // Authenticate the request
  const session = await getSessionSafely(req, interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const adminUserId = session.user.id;
  
  // Parse request body
  let body: KickRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  
  const { targetUserId, targetEmail, duration, roomUrl, reason, tenantId } = body;
  
  // Validate required fields
  if (!targetUserId) {
    return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 });
  }
  
  if (!duration || !Object.keys(TIMEOUT_DURATIONS).includes(duration)) {
    return NextResponse.json({ 
      error: 'Invalid duration. Must be one of: 5m, 15m, 30m, 60m, forever' 
    }, { status: 400 });
  }
  
  // For 'forever' duration, email is required to add to deny list
  if (duration === 'forever' && !targetEmail) {
    return NextResponse.json({ 
      error: 'targetEmail is required for permanent bans' 
    }, { status: 400 });
  }
  
  // Verify admin status
  // Check if user is a tenant admin (if tenantId provided) or superadmin
  let isAdmin = false;
  
  if (tenantId) {
    try {
      isAdmin = await TenantActions.userHasAccess(adminUserId, tenantId, TenantRole.ADMIN);
    } catch (error) {
      log.warn('Failed to check tenant admin status', { error, adminUserId, tenantId });
    }
  }
  
  // Also check for superadmin status
  const { isSuperAdmin } = await import('@nia/prism/core/auth/auth.middleware');
  if (isSuperAdmin(adminUserId)) {
    isAdmin = true;
  }
  
  if (!isAdmin) {
    log.warn('Non-admin attempted to kick user', {
      adminUserId,
      targetUserId,
      tenantId,
    });
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }
  
  // Prevent self-kick
  if (targetUserId === adminUserId) {
    return NextResponse.json({ error: 'Cannot kick yourself' }, { status: 400 });
  }
  
  log.info('Admin kick request received', {
    adminUserId,
    targetUserId,
    targetEmail: targetEmail ? `${targetEmail.slice(0, 3)}***` : undefined,
    duration,
    roomUrl: roomUrl ? roomUrl.slice(-20) : undefined,
    reason,
  });
  
  try {
    // Apply the timeout
    const { success, isForever } = await setUserTimeout(
      targetUserId,
      duration,
      adminUserId,
      roomUrl,
      reason
    );
    
    if (!success) {
      return NextResponse.json({ error: 'Failed to apply timeout' }, { status: 500 });
    }
    
    // If 'forever', add to global deny list
    if (isForever && targetEmail) {
      try {
        const globalSettings = await GlobalSettingsActions.getGlobalSettings();
        const currentDenyList = globalSettings.denyListEmails || [];
        
        // Normalize email and check if already in list
        const normalizedEmail = targetEmail.toLowerCase().trim();
        if (!currentDenyList.some(e => e.toLowerCase() === normalizedEmail)) {
          await GlobalSettingsActions.upsertGlobalSettings({
            denyListEmails: [...currentDenyList, normalizedEmail],
          });
          
          log.info('User added to global deny list', {
            targetEmail: normalizedEmail,
            adminUserId,
          });
        } else {
          log.info('User already in deny list', {
            targetEmail: normalizedEmail,
          });
        }
      } catch (denyListError) {
        log.error('Failed to add user to deny list', { error: denyListError });
        // Continue - the kick was successful, just warn about deny list failure
        return NextResponse.json({
          success: true,
          message: 'User kicked but failed to add to permanent deny list',
          duration,
          targetUserId,
          isForever: true,
          denyListError: true,
        });
      }
    }
    
    const durationLabel = isForever ? 'permanently' : duration;
    
    return NextResponse.json({
      success: true,
      message: `User ${isForever ? 'permanently banned' : `kicked for ${durationLabel}`}`,
      duration,
      targetUserId,
      isForever,
    });
    
  } catch (error) {
    log.error('Failed to kick user', {
      error,
      adminUserId,
      targetUserId,
      duration,
    });
    
    return NextResponse.json({ 
      error: 'Failed to kick user',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * GET /api/dailyCall/kick?userId=xxx&roomUrl=xxx
 * Check if a user is currently in timeout
 */
export async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const roomUrl = searchParams.get('roomUrl') || undefined;
  
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  
  try {
    const { getUserTimeout } = await import('../lib/userTimeout');
    const timeout = await getUserTimeout(userId, roomUrl);
    
    return NextResponse.json({
      userId,
      ...timeout,
    });
  } catch (error) {
    log.error('Failed to check user timeout', { error, userId });
    return NextResponse.json({ 
      error: 'Failed to check timeout status' 
    }, { status: 500 });
  }
}
