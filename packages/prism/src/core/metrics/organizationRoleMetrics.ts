// Minimal in-memory counters for organization role operations.
// Replace with OpenTelemetry / Prometheus client when available.

export const organizationRoleMetrics = {
  assignTotal: 0,
  updateTotal: 0,
  deleteTotal: 0,
  listTotal: 0,
  errorsTotal: 0,
};

export function inc(metric: keyof typeof organizationRoleMetrics) {
  organizationRoleMetrics[metric]++;
}
