// Imported once by server environments to start the prune scheduler when configured.
import process from 'process';
import { startResetTokenPruneScheduler } from './prune-scheduler';
import { getLogger } from '../logger';

const log = getLogger('prism:email');

// Persistence default enabled; disable only if explicitly 'disabled'
if (process.env.RESET_TOKEN_PERSISTENCE !== 'disabled') {
  // Avoid accidental startup in test unless explicitly desired (set flag in test if needed)
  if (process.env.NODE_ENV !== 'test') {
    try {
      startResetTokenPruneScheduler();
    } catch (e) {
      log.error('Failed to start prune scheduler', { error: e });
    }
  }
}
