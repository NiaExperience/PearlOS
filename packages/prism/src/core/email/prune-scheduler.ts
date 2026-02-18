// Simple optional pruning scheduler for expired reset/invite tokens.
// Activated when RESET_TOKEN_PRUNE_INTERVAL_MS is set (>0) and persistence is enabled.

import { pruneExpiredResetPasswordTokens } from '../actions/reset-password-token-actions';
import { getLogger } from '../logger';

const log = getLogger('prism:email');

let timer: NodeJS.Timeout | null = null;

export function startResetTokenPruneScheduler() {
    const intervalStr = process.env.RESET_TOKEN_PRUNE_INTERVAL_MS;
    if (!intervalStr) {
        if (process.env.DEBUG_PRISM === 'true') {
            log.info('RESET_TOKEN_PRUNE_INTERVAL_MS not set, skipping token pruning');
        }
        return;
    }

    if (process.env.DEBUG_PRISM === 'true') {
        log.info('Starting reset token prune scheduler', { intervalMs: intervalStr });
    }
    const interval = parseInt(intervalStr, 10);
    if (!interval || interval <= 0) return;
    if (timer) return; // already running
    timer = setInterval(async () => {
        try {
            const count = await pruneExpiredResetPasswordTokens();
            if (count > 0 && process.env.DEBUG_PRISM === 'true') {
                log.info('Removed expired reset/invite tokens', { removedCount: count });
            }
        } catch (e) {
            log.error('Token prune error', { error: e });
        }
    }, interval).unref();
}

export function stopResetTokenPruneScheduler() {
    if (timer) {
        clearInterval(timer);
        if (process.env.DEBUG_PRISM === 'true') {
            log.info('Stopped reset token prune scheduler');
        }
        timer = null;
    }
}
