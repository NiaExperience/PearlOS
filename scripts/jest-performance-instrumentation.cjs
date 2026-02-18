/** Early instrumentation to wrap Prism core, actions, data-bridge, and Mesh cache service before any imports. */
console.log('🛠️ [cjs] Entering early instrumentation file');
if (process.env.PERF_FN_METRICS === 'true') {
  try {
    const { performance } = require('perf_hooks');
    const path = require('path');
    const glob = require('glob');

    global.functionPerformanceMetrics = global.functionPerformanceMetrics || {};
    const METRIC_KEY = Symbol('fn_metric_wrapped');
    const CLASS_WRAPPED = Symbol('class_metric_wrapped');

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
        // Return a plain function (not jest.fn) so jest.spyOn in tests only sees calls after spy is attached
        try { Object.defineProperty(impl, 'name', { value: fn.name, configurable: true }); } catch (_) {}
        impl[METRIC_KEY] = true;
        return impl;
      }

      function wrapClass(Cls, className) {
        if (typeof Cls !== 'function') return Cls;
        if (Cls[CLASS_WRAPPED]) return Cls;
        const proto = Cls.prototype || {};
        Object.getOwnPropertyNames(proto).forEach(name => {
          if (name === 'constructor') return;
          const desc = Object.getOwnPropertyDescriptor(proto, name);
          if (!desc || typeof desc.value !== 'function') return;
          const metricName = `${className}.${name}`;
          // Replace the prototype method in place so jest.spyOn(Cls.prototype, name) still works
          Object.defineProperty(Cls.prototype, name, {
            value: wrapFn(desc.value, metricName),
            configurable: true,
            writable: true,
            enumerable: desc.enumerable
          });
        });
        try { Object.defineProperty(Cls, CLASS_WRAPPED, { value: true }); } catch(_) {}
        return Cls;
      }

  function patchModuleInPlace(moduleName, actual) {
        if (!actual || typeof actual !== 'object') return actual;
        const isClass = (fn) => {
          try {
            // Works for ES classes even when there are only static members
            return typeof fn === 'function' && /^class\s/.test(Function.prototype.toString.call(fn));
          } catch (_) { return false; }
        };
        Object.keys(actual).forEach(key => {
          const val = actual[key];
          const looksPascalCase = typeof key === 'string' && /^[A-Z]/.test(key);
          if (typeof val === 'function' && isClass(val)) {
            // ES class (may have only static methods): patch prototype methods, do NOT replace export
            wrapClass(val, `${moduleName}.${key}`);
            return;
          } else if (typeof val === 'function' && looksPascalCase) {
            // Likely a constructor/class compiled by TS with only static members
            wrapClass(val, `${moduleName}.${key}`);
            return;
          } else if (typeof val === 'function' && val.prototype && Object.getOwnPropertyNames(val.prototype).length > 1) {
            // Heuristic fallback for classes from transpiled code: do NOT replace export
            wrapClass(val, `${moduleName}.${key}`);
            return;
          } else if (typeof val === 'function') {
    // Do not wrap jest mock functions to avoid altering test behavior
    if (val && val._isMockFunction) return;
            const wrapped = wrapFn(val, `${moduleName}.${key}`);
            try {
              Object.defineProperty(actual, key, { value: wrapped, configurable: true, writable: true, enumerable: true });
            } catch (_) {
              try { actual[key] = wrapped; } catch (_) {}
            }
          } else if (val && typeof val === 'object') {
            // Namespace-like object
            Object.keys(val).forEach(fnKey => {
              const v = val[fnKey];
              if (typeof v === 'function') {
        if (v && v._isMockFunction) return;
                const w = wrapFn(v, `${key}.${fnKey}`);
                try {
                  Object.defineProperty(val, fnKey, { value: w, configurable: true, writable: true, enumerable: true });
                } catch (_) {
                  try { val[fnKey] = w; } catch (_) {}
                }
              }
            });
          }
        });
        return actual;
      }
    // If Jest mocking API is available, register module mocks for Prism packages
    if (typeof jest !== 'undefined' && jest.doMock) {
  const WRAP_ACTIONS = process.env.PERF_WRAP_ACTIONS === 'true';
  const WRAP_DATA_BRIDGE = process.env.PERF_WRAP_DATA_BRIDGE === 'true';

      // Wrap Prism root export to capture Prism class methods
  jest.doMock('@nia/prism', () => {
        const actual = jest.requireActual('@nia/prism');
        // Patch top-level functions and Prism class in place
        patchModuleInPlace('@nia/prism', actual);
        if (actual.Prism) {
          wrapClass(actual.Prism, '@nia/prism.Prism');
        }
        return actual;
      });

      // Wrap data-bridge to capture PrismGraphQLClient and factory
      if (WRAP_DATA_BRIDGE) {
        jest.doMock('@nia/prism/data-bridge', () => {
          const actual = jest.requireActual('@nia/prism/data-bridge');
          // Patch functions in place
          patchModuleInPlace('@nia/prism/data-bridge', actual);
          if (actual.PrismGraphQLClient) {
            wrapClass(actual.PrismGraphQLClient, '@nia/prism/data-bridge.PrismGraphQLClient');
          }
          if (actual.PrismGraphQLFactory && typeof actual.PrismGraphQLFactory.create === 'function') {
            try {
              Object.defineProperty(actual.PrismGraphQLFactory, 'create', {
                value: wrapFn(actual.PrismGraphQLFactory.create, '@nia/prism/data-bridge.PrismGraphQLFactory.create'),
                configurable: true,
                writable: true,
                enumerable: true
              });
            } catch (_) {
              try { actual.PrismGraphQLFactory.create = wrapFn(actual.PrismGraphQLFactory.create, '@nia/prism/data-bridge.PrismGraphQLFactory.create'); } catch (_) {}
            }
          }
          return actual;
        });
      }
    } else {
      console.warn('⚠️ [cjs] Jest mocking API not available; still installing runtime loader hooks');
    }

    // Intercept Mesh CacheService loads and wrap methods regardless of import style
    try {
      const Module = require('module');
      const origLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        const exp = origLoad.apply(this, arguments);
        if (typeof request === 'string' && /cache\.service(\.|$)/.test(request)) {
          try {
            const maybeClass = exp && (exp.CacheService || exp.default || exp);
            const Cls = maybeClass && maybeClass.prototype ? maybeClass : null;
            if (Cls && !Cls[CLASS_WRAPPED]) {
              wrapClass(Cls, 'Mesh.CacheService');
            }
          } catch(_) {}
        }
        // Optionally wrap Prism core actions after they are loaded (non-intrusive, respects jest mocks)
        if (WRAP_ACTIONS && typeof request === 'string' && (
          request === '@nia/prism/core/actions' ||
          /@nia\/prism\/core\/actions\//.test(request) ||
          /\/packages\/prism\/src\/core\/actions\//.test(request)
        )) {
          try {
            if (exp && typeof exp === 'object') {
              patchModuleInPlace(request.includes('/actions/') ? request.split('/').pop() : '@nia/prism/core/actions', exp);
            }
          } catch(_) {}
        }
        return exp;
      };
    } catch(_) {}

    // Also attempt to patch already-loaded singletons (globalSetup may have loaded them before this file ran)
    try {
      const meshCachePath = path.resolve(process.cwd(), 'apps/mesh/src/services/cache.service');
      const exp = require(meshCachePath);
      const Cls = (exp && (exp.CacheService || exp.default)) || null;
      if (Cls) {
        // Wrap class methods in place for any instances
        wrapClass(Cls, 'Mesh.CacheService');
        // Patch current singleton instance if exists/obtainable
        if (typeof Cls.getInstance === 'function') {
          const inst = Cls.getInstance();
          if (inst) {
            ['get','set','delete','deletePattern','clearAllCache','getByBlockId','getByPageId','getByParentId','getByType','getByIndexer','getComplexQuery','setComplexQuery','invalidateOnCreate','invalidateOnUpdate','invalidateOnDelete','shutdown','del','loadById','invalidatePatternKeys']
              .forEach(name => {
                if (typeof inst[name] === 'function') {
                  inst[name] = wrapFn(inst[name].bind(inst), `Mesh.CacheService.${name}`);
                }
              });
          }
        }
      }
    } catch(_) {}

    // Patch Prism instance methods if available already
    try {
      const prismExp = require('@nia/prism');
      const PrismClass = prismExp && prismExp.Prism;
      if (PrismClass) {
        // Wrap class prototype in place
        wrapClass(PrismClass, '@nia/prism.Prism');
        if (typeof PrismClass.getInstance === 'function') {
          Promise.resolve(PrismClass.getInstance()).then(prism => {
            if (prism) {
              Object.getOwnPropertyNames(Object.getPrototypeOf(prism)).forEach(name => {
                if (name === 'constructor') return;
                if (typeof prism[name] === 'function') {
                  prism[name] = wrapFn(prism[name].bind(prism), `@nia/prism.Prism.${name}`);
                }
              });
            }
          }).catch(() => {});
        }
      }
    } catch(_) {}
  } catch (e) {
    console.warn('⚠️ [cjs] Failed early instrumentation (mocks):', e.message);
  }
}
