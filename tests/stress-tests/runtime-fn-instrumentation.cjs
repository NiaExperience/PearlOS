#!/usr/bin/env node
/**
 * runtime-fn-instrumentation.cjs
 * Lightweight function-level metrics for runtime (Clinic/autocannon) runs.
 * - Wraps Prism action functions to record call counts and durations.
 * - Writes a JSON + console summary at process exit under performance-reports/.
 * - Filters naturally to in-repo sources by selecting our own exported functions only.
 */

try {
  const { performance } = require('perf_hooks');
  const fs = require('fs');
  const path = require('path');

  if (process.env.PERF_FN_METRICS !== 'true') {
    // No-op when disabled
    return;
  }

  const METRIC_KEY = Symbol('fn_metric_wrapped');
  global.functionPerformanceMetrics = global.functionPerformanceMetrics || {}; // name -> stats

  function recordMetric(name, duration, errored) {
    let m = global.functionPerformanceMetrics[name];
    if (!m) {
      m = { name, calls: 0, totalTime: 0, max: 0, min: Number.POSITIVE_INFINITY, errors: 0 };
      global.functionPerformanceMetrics[name] = m;
    }
    m.calls += 1;
    m.totalTime += duration;
    if (duration > m.max) m.max = duration;
    if (duration < m.min) m.min = duration;
    if (errored) m.errors += 1;
  }

  function wrapFunction(container, key, metricName) {
    const original = container[key];
    if (typeof original !== 'function') return false;
    if (original[METRIC_KEY]) return false;
    const wrapped = function(...args) {
      const start = performance.now();
      try {
        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') {
          return result.then(r => { recordMetric(metricName, performance.now() - start, false); return r; })
                       .catch(err => { recordMetric(metricName, performance.now() - start, true); throw err; });
        }
        recordMetric(metricName, performance.now() - start, false);
        return result;
      } catch (err) {
        recordMetric(metricName, performance.now() - start, true);
        throw err;
      }
    };
    try { Object.defineProperty(wrapped, 'name', { value: original.name, configurable: true }); } catch (_) {}
    wrapped[METRIC_KEY] = true;
    container[key] = wrapped;
    return true;
  }

  function wrapNamespace(nsName, nsObj) {
    if (!nsObj || typeof nsObj !== 'object') return 0;
    let count = 0;
    Object.keys(nsObj).forEach(fnKey => { if (wrapFunction(nsObj, fnKey, `${nsName}.${fnKey}`)) count++; });
    return count;
  }

  // Resolve Prism actions from package (built) or fallback to TS sources via ts-node
  let actionsIndex = null;
  try {
    actionsIndex = require('@nia/prism/core/actions');
  } catch (e) {
    try {
      // Enable TS transpile-only to import sources if dist not built
      require('ts-node/register/transpile-only');
      const actionsDir = path.resolve(process.cwd(), 'packages/prism/src/core/actions');
      actionsIndex = require(path.join(actionsDir, 'index.ts'));
    } catch (e2) {
      console.warn('[fn-metrics] Failed to load Prism actions for instrumentation:', e2.message);
    }
  }

  let wrapped = 0;
  if (actionsIndex) {
    Object.keys(actionsIndex).forEach(namespaceKey => {
      wrapped += wrapNamespace(namespaceKey, actionsIndex[namespaceKey]);
    });
  }

  if (wrapped > 0) {
    console.log(`🧪 [fn-metrics] Runtime function instrumentation enabled (wrapped ${wrapped} actions)`);
  } else {
    console.warn('[fn-metrics] No Prism actions wrapped (check build or paths)');
  }

  function writeReport() {
    try {
      const metrics = Object.values(global.functionPerformanceMetrics || {});
      if (!metrics.length) return;
      metrics.forEach(m => { m.avgTime = m.calls ? m.totalTime / m.calls : 0; if (!isFinite(m.min)) m.min = 0; });
      metrics.sort((a, b) => b.totalTime - a.totalTime);
      const top10 = metrics.slice(0, 10);

      const outDir = path.join(process.cwd(), 'performance-reports');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:]/g, '-');
      const outFile = path.join(outDir, `runtime-fn-metrics-${ts}.json`);
      fs.writeFileSync(outFile, JSON.stringify({ meta: { source: 'runtime', wrapped }, metrics }, null, 2));
      console.log(`[fn-metrics] Wrote ${outFile}`);

      // Console summary
      console.table(top10.map(m => ({ Function: m.name, Calls: m.calls, 'Avg (ms)': m.avgTime.toFixed(2), 'Total (ms)': m.totalTime.toFixed(2), 'Max (ms)': m.max.toFixed(2), 'Min (ms)': m.min.toFixed(2), Errors: m.errors })));
    } catch (e) {
      console.warn('[fn-metrics] Failed to write report:', e.message);
    }
  }

  process.on('exit', writeReport);
  process.on('SIGINT', () => { writeReport(); process.exit(0); });
  process.on('SIGTERM', () => { writeReport(); process.exit(0); });
} catch (e) {
  console.warn('[fn-metrics] Instrumentation errored:', e.message);
}
