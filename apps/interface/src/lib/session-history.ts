import { getClientLogger } from './client-logger';
/**
 * Session History Tracking Utilities
 * 
 * Client-side utilities for tracking user actions to session history.
 * These functions call the /api/userProfile/history endpoints.
 */

interface RefId {
  type: string;
  id: string;
  description?: string;
}

interface SessionHistoryEntry {
  time: string;
  action: string;
  sessionId: string;
  refIds?: RefId[];
}

/**
 * Track a user action in session history
 * 
 * @param action - Description of the action (e.g., "Opens Notes app")
 * @param refIds - Optional array of reference IDs (e.g., Note IDs, HTML generation IDs)
 */
export async function trackSessionHistory(
  action: string,
  refIds?: RefId[]
): Promise<void> {
  const log = getClientLogger('[session-history]');
  try {
    const response = await fetch('/api/userProfile/history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, refIds }),
    });

    if (!response.ok) {
      log.warn('Failed to track session history', { status: response.status });
    }
  } catch (error) {
    log.warn('Error tracking session history', { error });
  }
}

/**
 * Get recent session history entries
 * 
 * @param count - Number of recent entries to retrieve (default: 5)
 * @returns Array of session history entries
 */
export async function getSessionHistory(count: number = 5): Promise<SessionHistoryEntry[]> {
  const log = getClientLogger('[session-history]');
  try {
    const response = await fetch(`/api/userProfile/history?count=${count}`);
    
    if (!response.ok) {
      log.warn('Failed to get session history', { status: response.status });
      return [];
    }

    const data = await response.json();
    return data.history || [];
  } catch (error) {
    log.warn('Error getting session history', { error });
    return [];
  }
}
