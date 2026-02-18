// Lightweight audit logger. Future: pluggable sink (database, external log collector).
// For now we emit structured JSON on one line via the shared logger for easy grep.

import { getLogger } from '../logger';

export interface AuditEvent {
  ts: string;              // ISO timestamp
  actorId: string;         // User performing the action
  action: string;          // e.g. org.role.assign
  tenantId?: string;
  organizationId?: string;
  targetUserId?: string;
  userOrganizationRoleId?: string;
  prevRole?: string;
  newRole?: string;
  status: 'success' | 'error';
  message?: string;        // Error or supplemental information
}

const auditLogger = getLogger('prism:audit');

export function logAudit(event: AuditEvent) {
  auditLogger.info('AUDIT event', { event });
}
