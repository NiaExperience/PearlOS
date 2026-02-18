/**
 * Jest Performance Setup
 * Instruments tests with industry-standard performance monitoring
 */
console.log('🛠️ Entering jest-performance-setup.js (diagnostic)');
const { performance, PerformanceObserver } = require('perf_hooks');

// Global performance tracking
global.performanceData = {
  apiCalls: [],
  databaseQueries: [],
  resolverTimes: [],
  customMetrics: []
};

// Create PerformanceObserver for automatic timing collection
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name.startsWith('test-')) {
      global.performanceData.customMetrics.push({
        name: entry.name,
        duration: entry.duration,
        startTime: entry.startTime,
        timestamp: new Date().toISOString()
      });
    }
  }
});

obs.observe({ entryTypes: ['measure'] });

// Store observer globally for cleanup
global.__performanceObserver = obs;

// Enhanced console.time/timeEnd for automatic collection
const originalConsoleTime = console.time;
const originalConsoleTimeEnd = console.timeEnd;

console.time = function(label) {
  performance.mark(`${label}-start`);
  return originalConsoleTime.call(this, label);
};

console.timeEnd = function(label) {
  performance.mark(`${label}-end`);
  performance.measure(`test-${label}`, `${label}-start`, `${label}-end`);
  return originalConsoleTimeEnd.call(this, label);
};

// Hook into fetch for API call tracking
if (typeof global.fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

const originalFetch = global.fetch;
global.fetch = async function(...args) {
  const startTime = performance.now();
  const url = args[0];
  
  try {
    const response = await originalFetch.apply(this, args);
    const endTime = performance.now();
    
    global.performanceData.apiCalls.push({
      url: typeof url === 'string' ? url : url.url,
      method: args[1]?.method || 'GET',
      duration: endTime - startTime,
      status: response.status,
      timestamp: new Date().toISOString()
    });
    
    return response;
  } catch (error) {
    const endTime = performance.now();
    
    global.performanceData.apiCalls.push({
      url: typeof url === 'string' ? url : url.url,
      method: args[1]?.method || 'GET',
      duration: endTime - startTime,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    throw error;
  }
};

// Add performance helpers to global scope
global.performanceHelpers = {
  // Start timing an operation
  startTiming: (label) => {
    performance.mark(`${label}-start`);
  },
  
  // End timing an operation  
  endTiming: (label) => {
    performance.mark(`${label}-end`);
    performance.measure(`test-${label}`, `${label}-start`, `${label}-end`);
  },
  
  // Measure a function execution
  measureFunction: async (label, fn) => {
    const startTime = performance.now();
    try {
      const result = await fn();
      const endTime = performance.now();
      
      global.performanceData.customMetrics.push({
        name: label,
        duration: endTime - startTime,
        success: true,
        timestamp: new Date().toISOString()
      });
      
      return result;
    } catch (error) {
      const endTime = performance.now();
      
      global.performanceData.customMetrics.push({
        name: label,
        duration: endTime - startTime,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      throw error;
    }
  },
  
  // Get current performance snapshot
  getSnapshot: () => ({
    ...global.performanceData,
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage && process.cpuUsage(),
    timestamp: new Date().toISOString()
  })
};

// Jest hooks for per-test cleanup
beforeEach(() => {
  // Reset performance data for each test
  global.performanceData = {
    apiCalls: [],
    databaseQueries: [],
    resolverTimes: [],
    customMetrics: []
  };
});

afterEach(() => {
  // Optional: Log performance data after each test
  if (process.env.PERF_MONITOR === 'true') {
    const snapshot = global.performanceHelpers.getSnapshot();
    if (snapshot.apiCalls.length > 0 || snapshot.customMetrics.length > 0) {
      console.log(`📊 Test Performance Data:`, {
        apiCalls: snapshot.apiCalls.length,
        customMetrics: snapshot.customMetrics.length,
        memoryMB: (snapshot.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)
      });
    }
  }
});

// Global cleanup function for Jest teardown
global.__cleanupPerformanceMonitoring = function() {
  try {
    if (global.__performanceObserver) {
      global.__performanceObserver.disconnect();
      global.__performanceObserver = null;
    }
    
    // Clear performance data
    global.performanceData = null;
    global.performanceHelpers = null;
    
    // Restore original console methods
    if (originalConsoleTime) {
      console.time = originalConsoleTime;
    }
    if (originalConsoleTimeEnd) {
      console.timeEnd = originalConsoleTimeEnd;
    }
    
    // Restore original fetch
    if (originalFetch) {
      global.fetch = originalFetch;
    }
    
    // Force close any remaining streams or handles
    try {
      const activeHandles = process._getActiveHandles ? process._getActiveHandles() : [];
      activeHandles.forEach(handle => {
        try {
          if (handle && handle.constructor) {
            // Close WriteStreams from report generation
            if (handle.constructor.name === 'WriteStream' && typeof handle.end === 'function') {
              handle.end();
            }
            // Destroy sockets
            if (handle.constructor.name === 'Socket' && typeof handle.destroy === 'function') {
              handle.destroy();
            }
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    } catch (e) {
      // Ignore if _getActiveHandles is not available
    }
    
    console.log('🧹 Performance monitoring cleanup completed');
  } catch (error) {
    console.warn('⚠️ Performance monitoring cleanup error:', error.message);
  }
};

// Handle process exit to ensure cleanup
process.on('exit', () => {
  if (global.__cleanupPerformanceMonitoring) {
    global.__cleanupPerformanceMonitoring();
  }
});

process.on('SIGINT', () => {
  if (global.__cleanupPerformanceMonitoring) {
    global.__cleanupPerformanceMonitoring();
  }
});

process.on('SIGTERM', () => {
  if (global.__cleanupPerformanceMonitoring) {
    global.__cleanupPerformanceMonitoring();
  }
});

console.log('🔬 Performance monitoring setup complete');

// Function-level instrumentation for core Prism actions via jest.doMock wrappers
// This approach avoids mutating ESM namespace exports (read-only) by returning wrapped clones.
if (process.env.PERF_FN_METRICS === 'true') {
  try {
    const path = require('path');
    const glob = require('glob');

    global.functionPerformanceMetrics = global.functionPerformanceMetrics || {};
    const METRIC_KEY = Symbol('fn_metric_wrapped');

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

  function wrapFn(fn, metricName) {
      if (typeof fn !== 'function') return fn;
      if (fn[METRIC_KEY]) return fn;
    const impl = function(...args) {
        const start = performance.now();
        try {
      const result = fn.apply(this, args);
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
    const wrapped = jest.fn(impl);
    try { Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true }); } catch (_) {}
    wrapped[METRIC_KEY] = true;
    return wrapped;
    }

    function wrapModuleExports(moduleName, actual) {
      const clone = {};
      Object.keys(actual).forEach(key => {
        const val = actual[key];
        if (typeof val === 'function') {
          const wrapped = wrapFn(val, `${moduleName}.${key}`);
          Object.defineProperty(clone, key, { value: wrapped, configurable: true, writable: true, enumerable: true });
        } else if (val && typeof val === 'object') {
          // Namespace object: clone shallow and wrap functions inside
          const ns = {};
          Object.keys(val).forEach(fnKey => {
            const v = val[fnKey];
            if (typeof v === 'function') {
              const w = wrapFn(v, `${key}.${fnKey}`);
              Object.defineProperty(ns, fnKey, { value: w, configurable: true, writable: true, enumerable: true });
            } else {
              ns[fnKey] = v;
            }
          });
          Object.defineProperty(clone, key, { value: ns, configurable: true, writable: true, enumerable: true });
        } else {
          Object.defineProperty(clone, key, { value: val, configurable: true, writable: true, enumerable: true });
        }
      });
      // Preserve default export if exists
      if (actual && Object.prototype.hasOwnProperty.call(actual, 'default') && !clone.default) {
        clone.default = actual.default;
      }
      return clone;
    }

    // 1) Wrap the aggregated actions index module
    jest.doMock('@nia/prism/core/actions', () => {
      // Use requireActual to keep true implementation
      const actual = jest.requireActual('@nia/prism/core/actions');
      return wrapModuleExports('@nia/prism/core/actions', actual);
    });

    // 2) Wrap each direct *-actions submodule to catch destructured imports
    const actionsDir = path.resolve(process.cwd(), 'packages/prism/src/core/actions');
    const actionFiles = glob.sync(path.join(actionsDir, '*-actions.@(ts|js)'));
    actionFiles.forEach(file => {
      const base = path.basename(file).replace(/\.(ts|js)$/,'');
      const aliasPath = `@nia/prism/core/actions/${base}`;
      jest.doMock(aliasPath, () => {
        const actual = jest.requireActual(aliasPath);
        return wrapModuleExports(base, actual);
      });
    });

  console.log('🧪 Function-level performance instrumentation enabled via jest.doMock (PERF_FN_METRICS=true)');
  } catch (e) {
    console.warn('⚠️ Failed to enable function performance metrics (mocks):', e.message);
  }
}

// Extend default test timeout for performance runs (90s)
try {
  if (typeof jest !== 'undefined' && jest.setTimeout) {
    jest.setTimeout(90_000);
    console.log('⏱️ Jest timeout set to 90s for performance tests');
  }
} catch (e) {
  // ignore if jest global not present yet
}

// Persist function metrics for this test environment so the reporter can merge across workers/environments
if (process.env.PERF_FN_METRICS === 'true') {
  try {
    const fs = require('fs');
    const path = require('path');
    const outDir = path.join(process.cwd(), 'performance-reports');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'fn-metrics.jsonl');

    // Write at end of each test file to minimize I/O
    afterAll(() => {
      try {
        const raw = global.functionPerformanceMetrics || {};
        const arr = Object.values(raw);
        if (arr.length) {
          fs.appendFileSync(outPath, JSON.stringify({ file: expect.getState && expect.getState().testPath, metrics: arr }) + '\n');
        }
      } catch (e) {
        // best-effort only
      }
    });
  } catch (e) {
    // ignore
  }
}
