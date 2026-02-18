/**
 * Industry-standard Jest Performance Reporter
 * Outputs performance data in formats compatible with CI/CD and IDE tools
 */
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class JestPerformanceReporter {
  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = options || {};
    this.testResults = [];
    this.startTime = performance.now();

    // Ensure output directory exists
    this.outputDir = path.join(process.cwd(), 'performance-reports');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    // Path for cross-environment function metrics aggregation
    this.fnMetricsPath = path.join(this.outputDir, 'fn-metrics.jsonl');
  }

  onRunStart(aggregatedResult, options) {
    this.startTime = performance.now();
    console.log('🔬 Performance monitoring started...');
    // Reset any previous function metrics aggregation file
    try {
      if (fs.existsSync(this.fnMetricsPath)) fs.unlinkSync(this.fnMetricsPath);
    } catch {}
  }

  onTestResult(test, testResult, aggregatedResult) {
    // Extract performance data for each test
    testResult.testResults.forEach(result => {
      const perfData = {
        testName: result.fullName,
        testFile: test.path,
        duration: result.duration || 0,
        status: result.status,
        timestamp: new Date().toISOString(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage && process.cpuUsage(),
      };

      this.testResults.push(perfData);
    });
  }

  onRunComplete(contexts, results) {
    const endTime = performance.now();
    const totalDuration = endTime - this.startTime;

    // Capture function-level metrics if instrumentation enabled
    let functionMetrics = [];
    try {
      // Primary source: aggregated JSONL file written by test environments
      const merged = new Map(); // name -> {calls,totalTime,max,min,errors}
      if (fs.existsSync(this.fnMetricsPath)) {
        const lines = fs.readFileSync(this.fnMetricsPath, 'utf-8').split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const payload = JSON.parse(line);
            const arr = Array.isArray(payload) ? payload : payload.metrics;
            if (!Array.isArray(arr)) continue;
            for (const m of arr) {
              if (!m || !m.name) continue;
              const prev = merged.get(m.name) || { name: m.name, calls: 0, totalTime: 0, max: 0, min: Number.POSITIVE_INFINITY, errors: 0 };
              prev.calls += m.calls || 0;
              prev.totalTime += m.totalTime || 0;
              if (m.max !== undefined && m.max > prev.max) prev.max = m.max;
              const minVal = m.min === Number.POSITIVE_INFINITY ? Infinity : (m.min || 0);
              if (minVal < prev.min) prev.min = minVal;
              prev.errors += m.errors || 0;
              merged.set(m.name, prev);
            }
          } catch {}
        }
      }

      const rawMetrics = global.functionPerformanceMetrics || {};
      for (const k of Object.keys(rawMetrics)) {
        const m = rawMetrics[k];
        if (!m) continue;
        const prev = merged.get(m.name) || { name: m.name, calls: 0, totalTime: 0, max: 0, min: Number.POSITIVE_INFINITY, errors: 0 };
        prev.calls += m.calls || 0;
        prev.totalTime += m.totalTime || 0;
        if (m.max !== undefined && m.max > prev.max) prev.max = m.max;
        const minVal = m.min === Number.POSITIVE_INFINITY ? Infinity : (m.min || 0);
        if (minVal < prev.min) prev.min = minVal;
        prev.errors += m.errors || 0;
        merged.set(m.name, prev);
      }

      const keys = Array.from(merged.keys());
      if (process.env.PERF_FN_METRICS === 'true') {
        console.log(`🔧 [PerfReporter] functionPerformanceMetrics keys: ${keys.length}`);
        if (!keys.length) {
          console.log('ℹ️ [PerfReporter] No function metrics captured. If you expected data:');
          console.log('   - Ensure you ran with PERF_FN_METRICS=true (npm run test:perf).');
          console.log('   - Confirm early instrumentation log appears ("🛠️ [cjs] Entering early instrumentation file").');
          console.log('   - Clear Jest cache if needed: npx jest --clearCache');
          console.log('   - Verify target functions are exported before tests execute.');
        }
      }

      if (keys.length) {
        functionMetrics = Array.from(merged.values())
          .map(m => ({
            name: m.name,
            calls: m.calls,
            totalTime: m.totalTime,
            avgTime: m.calls ? m.totalTime / m.calls : 0,
            max: m.max,
            min: m.min === Number.POSITIVE_INFINITY ? 0 : m.min,
            errors: m.errors,
          }))
          .sort((a, b) => b.avgTime - a.avgTime);
      }
    } catch (e) {
      console.warn('⚠️ [PerfReporter] Failed to build function metrics:', e.message);
    }

    // Generate comprehensive performance report
    const performanceReport = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalDuration: totalDuration,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        jestVersion: require('jest/package.json').version,
      },
      summary: {
        totalTests: results.numTotalTests,
        passedTests: results.numPassedTests,
        failedTests: results.numFailedTests,
        slowTests: this.testResults.filter(t => t.duration > 100).length,
        averageDuration:
          this.testResults.reduce((sum, t) => sum + t.duration, 0) / this.testResults.length,
      },
      tests: this.testResults,
      slowestTests: this.testResults.sort((a, b) => b.duration - a.duration).slice(0, 10),
      memoryProfile: {
        peak: Math.max(...this.testResults.map(t => t.memoryUsage.heapUsed)),
        average:
          this.testResults.reduce((sum, t) => sum + t.memoryUsage.heapUsed, 0) /
          this.testResults.length,
      },
      // ALWAYS include these properties so JSON schema is stable even when no metrics collected
      functions: functionMetrics,
      hottestFunctions: functionMetrics.slice(0, 10),
    };

    if (process.env.PERF_FN_METRICS === 'true') {
      console.log(
        `🔧 [PerfReporter] functions property present: ${Array.isArray(performanceReport.functions)} length=${performanceReport.functions.length}`
      );
    }

    // Output in multiple industry-standard formats
    this.generateJSONReport(performanceReport);
    this.generateCSVReport(performanceReport);
    this.generateJUnitXML(performanceReport);
    this.generateChromeTrace(performanceReport);
    this.generateMarkdownReport(performanceReport);
    this.generateHTMLReport(performanceReport);

    // Console summary
    this.printSummary(performanceReport);
  }

  generateJSONReport(report) {
    const filePath = path.join(
      this.outputDir,
      `performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    console.log(`📊 JSON Performance Report: ${filePath}`);
  }

  generateCSVReport(report) {
    const csvHeaders = 'Test Name,File,Duration (ms),Status,Memory (MB),Timestamp\n';
    const csvRows = report.tests
      .map(
        test =>
          `"${test.testName}","${test.testFile}",${test.duration},"${test.status}",${(test.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)},"${test.timestamp}"`
      )
      .join('\n');

    const filePath = path.join(this.outputDir, 'performance-tests.csv');
    fs.writeFileSync(filePath, csvHeaders + csvRows);
    console.log(`📈 CSV Performance Report: ${filePath}`);
  }

  generateJUnitXML(report) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Performance Tests" tests="${report.summary.totalTests}" time="${report.metadata.totalDuration / 1000}">
  <testsuite name="Performance" tests="${report.summary.totalTests}" time="${report.metadata.totalDuration / 1000}">
    ${report.tests
      .map(
        test => `
    <testcase name="${this.escapeXml(test.testName)}" classname="${this.escapeXml(test.testFile)}" time="${test.duration / 1000}">
      ${test.duration > 100 ? `<system-out>SLOW TEST: ${test.duration}ms</system-out>` : ''}
      ${test.status === 'failed' ? '<failure message="Test failed"/>' : ''}
    </testcase>`
      )
      .join('')}
  </testsuite>
</testsuites>`;

    const filePath = path.join(this.outputDir, 'performance-junit.xml');
    fs.writeFileSync(filePath, xml);
    console.log(`⚡ JUnit Performance Report: ${filePath}`);
  }

  generateChromeTrace(report) {
    const traceEvents = report.tests.map((test, index) => ({
      name: test.testName,
      cat: 'test',
      ph: 'X', // Complete event
      ts: Date.parse(test.timestamp) * 1000, // microseconds
      dur: test.duration * 1000, // microseconds
      pid: 1,
      tid: 1,
      args: {
        file: test.testFile,
        memoryMB: (test.memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
        status: test.status,
      },
    }));

    const traceData = {
      traceEvents,
      displayTimeUnit: 'ms',
      metadata: {
        'chrome-trace-format-version': '1.0',
        'jest-performance': report.metadata,
      },
    };

    const filePath = path.join(this.outputDir, 'performance-trace.json');
    fs.writeFileSync(filePath, JSON.stringify(traceData, null, 2));
    console.log(`🔍 Chrome Trace Format: ${filePath}`);
    console.log(`   Open in Chrome DevTools > Performance tab > Load profile`);
  }

  generateMarkdownReport(report) {
    const markdown = `# Performance Test Report

Generated: ${report.metadata.timestamp}

## Summary
- **Total Tests**: ${report.summary.totalTests}
- **Total Duration**: ${(report.metadata.totalDuration / 1000).toFixed(2)}s
- **Average Test Duration**: ${report.summary.averageDuration.toFixed(2)}ms
- **Slow Tests (>100ms)**: ${report.summary.slowTests}
- **Peak Memory**: ${(report.memoryProfile.peak / 1024 / 1024).toFixed(2)} MB

## Slowest Tests
| Test | File | Duration | Memory |
|------|------|----------|--------|
${report.slowestTests
  .map(
    test =>
      `| ${test.testName} | ${path.basename(test.testFile)} | ${test.duration}ms | ${(test.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB |`
  )
  .join('\n')}

${report.functions && report.functions.length > 0 ? `\n## Function-Level Metrics (Top 10 by Avg Time)\n| Function | Calls | Avg (ms) | Total (ms) | Max (ms) | Min (ms) | Errors |\n|----------|-------|----------|-----------|---------|---------|--------|\n${report.hottestFunctions.map(fn => `| ${fn.name} | ${fn.calls} | ${fn.avgTime.toFixed(2)} | ${fn.totalTime.toFixed(2)} | ${fn.max.toFixed(2)} | ${fn.min.toFixed(2)} | ${fn.errors} |`).join('\n')}\n\n<details><summary>All Functions</summary>\n\n| Function | Calls | Avg (ms) | Total (ms) | Max (ms) | Min (ms) | Errors |\n|----------|-------|----------|-----------|---------|---------|--------|\n${report.functions.map(fn => `| ${fn.name} | ${fn.calls} | ${fn.avgTime.toFixed(2)} | ${fn.totalTime.toFixed(2)} | ${fn.max.toFixed(2)} | ${fn.min.toFixed(2)} | ${fn.errors} |`).join('\n')}\n\n</details>` : ''}

## Environment
- **Node.js**: ${report.metadata.nodeVersion}
- **Platform**: ${report.metadata.platform}
- **Architecture**: ${report.metadata.arch}
- **Jest**: ${report.metadata.jestVersion}
`;

    const filePath = path.join(this.outputDir, 'performance-report.md');
    fs.writeFileSync(filePath, markdown);
    console.log(`📝 Markdown Report: ${filePath}`);
  }

  generateHTMLReport(report) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jest Performance Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1, h2 {
            color: #333;
            border-bottom: 2px solid #e1e1e1;
            padding-bottom: 10px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .metric-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 6px;
            border-left: 4px solid #007acc;
            text-align: center;
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #007acc;
            display: block;
        }
        .metric-label {
            color: #666;
            font-size: 0.9em;
            margin-top: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        tr:hover {
            background-color: #f8f9fa;
        }
        .status-passed {
            color: #28a745;
            font-weight: bold;
        }
        .status-failed {
            color: #dc3545;
            font-weight: bold;
        }
        .duration-slow {
            background-color: #fff3cd;
            color: #856404;
            font-weight: bold;
        }
        .duration-normal {
            color: #495057;
        }
        .env-info {
            background: #e9ecef;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
        .chart-container {
            height: 300px;
            margin: 30px 0;
            background: #f8f9fa;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #666;
        }
        .timestamp {
            color: #6c757d;
            font-size: 0.9em;
        }
    /* Sticky headers inside scrolling tables */
    .table-scroll { position: relative; }
    .table-scroll thead th {
      position: sticky;
      top: 0;
      background: #f8f9fa;
      z-index: 2;
      box-shadow: 0 1px 0 #ddd;
    }
    .table-scroll.scrolled thead th {
      box-shadow: 0 2px 4px rgba(0,0,0,0.12);
    }
    </style>
</head>
<body>
    <div class="container">
    <h1>🚀 Jest Performance Report</h1>
    <p class="timestamp">Generated: ${report.metadata.timestamp}</p>

    <h2>🖥️ Environment Information</h2>
    <div class="env-info" style="margin-top:10px;">
      <strong>Node.js:</strong> ${report.metadata.nodeVersion}<br>
      <strong>Platform:</strong> ${report.metadata.platform}<br>
      <strong>Architecture:</strong> ${report.metadata.arch}<br>
      <strong>Jest Version:</strong> ${report.metadata.jestVersion}
    </div>
    <div class="summary-grid" style="margin-top:10px;">
            <div class="metric-card">
                <span class="metric-value">${report.summary.totalTests}</span>
                <div class="metric-label">Total Tests</div>
            </div>
            <div class="metric-card">
                <span class="metric-value">${(report.metadata.totalDuration / 1000).toFixed(2)}s</span>
                <div class="metric-label">Total Duration</div>
            </div>
            <div class="metric-card">
                <span class="metric-value">${report.summary.averageDuration.toFixed(2)}ms</span>
                <div class="metric-label">Average Test Duration</div>
            </div>
            <div class="metric-card">
                <span class="metric-value">${report.summary.slowTests}</span>
                <div class="metric-label">Slow Tests (&gt;100ms)</div>
            </div>
            <div class="metric-card">
                <span class="metric-value">${(report.memoryProfile.peak / 1024 / 1024).toFixed(2)} MB</span>
                <div class="metric-label">Peak Memory</div>
            </div>
            <div class="metric-card">
                <span class="metric-value">${report.summary.passedTests}</span>
                <div class="metric-label">Passed Tests</div>
            </div>
      ${
        report.functions && report.functions.length
          ? `
      <div class=\"metric-card\">
        <span class=\"metric-value\">${report.functions.length}</span>
        <div class=\"metric-label\">Functions</div>
      </div>
      <div class=\"metric-card\">
        <span class=\"metric-value\">${report.functions.reduce((a, f) => a + f.calls, 0)}</span>
        <div class=\"metric-label\">Function Calls</div>
      </div>
      <div class=\"metric-card\">
        <span class=\"metric-value\">${Math.max(...report.functions.map(f => f.avgTime)).toFixed(2)}ms</span>
        <div class=\"metric-label\">Max Avg Function</div>
      </div>
            `
          : ''
      }
    </div>
        <h2>📈 Performance Analytics</h2>
        <div class="charts-wrapper" style="border:1px solid #e1e1e1; border-radius:8px; padding:10px; background:#fafafa;">
          <div class="chart-tabs" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
            ${[
              'Test Histogram',
              'Exec Order',
              'Dur vs Memory',
              'Test Pareto',
              'Func Total Time',
              'Func Bubble',
              'Func Cumulative',
              'Func Calls',
              'Func Errors',
              'Duration Percentiles',
            ]
              .map(
                (t, i) =>
                  `<button class=\"tab-btn\" data-chart-tab=\"chart${i}\" style=\"padding:6px 10px; border:1px solid #ccc; background:#fff; border-radius:4px; cursor:pointer; font-size:12px;\">${t}</button>`
              )
              .join('')}
          </div>
          <div id="chart-active-desc" style="font-size:12px; line-height:1.4; margin:0 0 10px; background:#fff; border:1px solid #e3e3e3; padding:8px 9px; border-radius:6px;">
            <strong style="font-size:12px;">Test Histogram</strong><br/>
            <em>Goal:</em> See how many tests fall into each duration bucket to quickly spot outliers.<br/>
            <em>Use it to:</em> Identify a long tail (few very slow tests) vs. a broad distribution (systemic slowness). Focus first on buckets with very small counts but large durations.<br/>
            <em>Axes:</em> X = Duration bucket (ms). Y = Number of tests in that bucket.
          </div>
          <div class="tab-panels" style="position:relative;">
            ${Array.from({ length: 10 })
              .map(
                (_, i) =>
                  `<div id=\"panel-chart${i}\" class=\"tab-panel\" style=\"display:${i === 0 ? 'block' : 'none'};\"><canvas id=\"chart${i}\" height=260></canvas></div>`
              )
              .join('')}
          </div>
          <div style="font-size:11px; color:#666; margin-top:6px;">Charts are generated from current run metrics. Some charts may hide if insufficient data.</div>
        </div>
        </div>

  <h2>🔍 All Test Results <button data-toggle="#all-tests" style="margin-left:10px;">Show/Hide</button></h2>
  <div id="all-tests" class="collapsible" style="border:1px solid #e1e1e1; border-radius:6px; padding:10px;">
    <div class="controls" style="margin-bottom:10px;">
  <label>Show Top <span id="test-range-val">${Math.min(10, report.tests.length)}</span> / ${report.tests.length}</label>
  <input id="test-range" type="range" min="1" max="${report.tests.length}" value="${Math.min(10, report.tests.length)}" style="width:300px;">
    </div>
    <div class="table-scroll" style="max-height:340px; overflow-y:auto;">
      <table>
        <thead>
          <tr>
            <th data-test-sort="name">Test Name</th>
            <th data-test-sort="file">File</th>
            <th data-test-sort="duration">Duration</th>
            <th data-test-sort="status">Status</th>
            <th data-test-sort="memoryMB">Memory Usage</th>
            <th data-test-sort="ts">Timestamp</th>
          </tr>
        </thead>
        <tbody id="all-tests-body"></tbody>
      </table>
    </div>
  </div>

  ${
    report.functions && report.functions.length > 0
      ? `
        <h2>🧬 All Functions <button data-toggle="#all-functions" style="margin-left:10px;">Show/Hide</button></h2>
        <div id="all-functions" class="collapsible" style="border:1px solid #e1e1e1; border-radius:6px; padding:10px;">
          <div class="controls" style="margin-bottom:10px;">
            <label>Show Top <span id="fn-range-val">${Math.min(10, report.functions.length)}</span> / ${report.functions.length}</label>
            <input id="fn-range" type="range" min="1" max="${report.functions.length}" value="${Math.min(10, report.functions.length)}" style="width:300px;">
          </div>
          <div class="table-scroll" style="max-height:340px; overflow-y:auto;">
            <table>
              <thead>
                <tr>
                  <th data-fn-sort="name">Function</th><th data-fn-sort="calls">Calls</th><th data-fn-sort="avgTime">Avg (ms)</th><th data-fn-sort="totalTime">Total (ms)</th><th data-fn-sort="max">Max (ms)</th><th data-fn-sort="min">Min (ms)</th><th data-fn-sort="errors">Errors</th>
                </tr>
              </thead>
              <tbody id="all-fn-body"></tbody>
            </table>
          </div>
        </div>`
      : '<!-- No function metrics collected -->'
  }
    </div>
    <script>
  document.querySelectorAll('[data-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = document.querySelector(btn.getAttribute('data-toggle'));
          if (target) target.style.display = target.style.display === 'none' ? 'block' : 'none';
        });
      });
      const _testData = ${JSON.stringify(
        (report.tests || []).map(t => ({
          name: t.testName,
          file: path.basename(t.testFile),
          duration: t.duration,
          status: t.status,
          memoryMB: +(t.memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
          ts: t.timestamp,
        }))
      )};
      let _testSorted = _testData.slice();
  const _fnData = ${JSON.stringify(report.functions || [])};
      let _fnSorted = _fnData.slice();
      const fnBody = document.getElementById('all-fn-body');
      const range = document.getElementById('fn-range');
      const rangeVal = document.getElementById('fn-range-val');
      const testBody = document.getElementById('all-tests-body');
      const testRange = document.getElementById('test-range');
      const testRangeVal = document.getElementById('test-range-val');
      function renderFunctions(limit) {
        if (!fnBody) return;
        const rows = _fnSorted.slice(0, limit).map(fn => {
          const displayName = fn.name.length > 80 ? fn.name.substring(0,80) + '…' : fn.name;
          return '<tr>'+
            '<td title="'+fn.name+'">'+displayName+'</td>'+
            '<td>'+fn.calls+'</td>'+
            '<td>'+fn.avgTime.toFixed(2)+'</td>'+
            '<td>'+fn.totalTime.toFixed(2)+'</td>'+
            '<td>'+fn.max.toFixed(2)+'</td>'+
            '<td>'+fn.min.toFixed(2)+'</td>'+
            '<td>'+fn.errors+'</td>'+
            '</tr>';
        }).join('');
        fnBody.innerHTML = rows;
      }
      function renderTests(limit) {
        if (!testBody) return;
        const rows = _testSorted.slice(0, limit).map(t => {
          const nameDisplay = t.name.length > 50 ? t.name.substring(0,50)+'...' : t.name;
          const cls = t.duration > 100 ? 'duration-slow' : 'duration-normal';
          return '<tr>'+
            '<td title="'+t.name+'">'+nameDisplay+'</td>'+
            '<td title="'+t.file+'">'+t.file+'</td>'+
            '<td class="'+cls+'">'+t.duration+'ms</td>'+
            '<td class="status-'+t.status+'">'+t.status+'</td>'+
            '<td>'+t.memoryMB.toFixed(2)+' MB</td>'+
            '<td class="timestamp">'+new Date(t.ts).toLocaleTimeString()+'</td>'+
            '</tr>';
        }).join('');
        testBody.innerHTML = rows;
      }
      if (range) {
        renderFunctions(parseInt(range.value,10));
        range.addEventListener('input', () => { rangeVal.textContent = range.value; renderFunctions(parseInt(range.value,10)); });
      }
      if (testRange) {
        renderTests(parseInt(testRange.value,10));
        testRange.addEventListener('input', () => { testRangeVal.textContent = testRange.value; renderTests(parseInt(testRange.value,10)); });
      }

      // Add scroll shadow effect for sticky header clarity
      document.querySelectorAll('.table-scroll').forEach(scroller => {
        scroller.addEventListener('scroll', () => {
          if (scroller.scrollTop > 0) scroller.classList.add('scrolled'); else scroller.classList.remove('scrolled');
        });
      });

      function sortArray(dataArr, key, dir) {
        return dataArr.slice().sort((a,b) => {
          const av = a[key];
          const bv = b[key];
          if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
          return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
      }
      // Attach sorting to function headers
      document.querySelectorAll('th[data-fn-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
          const key = th.getAttribute('data-fn-sort');
          const current = th.getAttribute('data-dir') === 'asc' ? 'asc' : 'desc';
            const next = current === 'asc' ? 'desc' : 'asc';
          document.querySelectorAll('th[data-fn-sort]').forEach(h => h.removeAttribute('data-dir'));
          th.setAttribute('data-dir', next);
          _fnSorted = sortArray(_fnData, key, next);
          renderFunctions(parseInt(range ? range.value : _fnSorted.length,10));
        });
      });
      // Attach sorting to test headers
      document.querySelectorAll('th[data-test-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
          const key = th.getAttribute('data-test-sort');
          const current = th.getAttribute('data-dir') === 'asc' ? 'asc' : 'desc';
          const next = current === 'asc' ? 'desc' : 'asc';
          document.querySelectorAll('th[data-test-sort]').forEach(h => h.removeAttribute('data-dir'));
          th.setAttribute('data-dir', next);
          _testSorted = sortArray(_testData, key, next);
          renderTests(parseInt(testRange ? testRange.value : _testSorted.length,10));
        });
      });

      // ========= Charts (Chart.js) =========
      const chartScript = document.createElement('script');
      chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      chartScript.onload = () => { initCharts(); };
      document.head.appendChild(chartScript);

      let charts = {}; let chartsInited = {}; // lazy init per tab
      function initCharts(){
        const descMap = {
          chart0: '<strong style="font-size:12px;">Test Histogram</strong><br/><em>Goal:</em> Understand distribution of test durations and spot outliers quickly.<br/><em>Use it to:</em> Target slow buckets first (rightmost with few bars). If the whole distribution shifts right, investigate global setup/teardown or environment slowness.<br/><em>Axes:</em> X = Duration bucket (ms). Y = Number of tests.',
          chart1: '<strong style="font-size:12px;">Execution Order</strong><br/><em>Goal:</em> See duration trend over run order to detect warming, caching, or resource contention effects.<br/><em>Use it to:</em> Early spikes → expensive initializations; late spikes → memory growth / resource leaks; periodic waves → shared external dependency contention.<br/><em>Axes:</em> X = Test index in execution order (1 = first run). Y = Duration (ms).',
          chart2: '<strong style="font-size:12px;">Duration vs Memory</strong><br/><em>Goal:</em> Correlate test runtime with peak heap usage to isolate memory-bound tests.<br/><em>Use it to:</em> Look for a diagonal (higher memory = higher duration). Tight vertical cluster = memory not a driver. Outliers far right but low memory → likely CPU / I/O bound.<br/><em>Axes:</em> X = Duration (ms). Y = Peak heap (MB).',
          chart3: '<strong style="font-size:12px;">Test Pareto (80/20)</strong><br/><em>Goal:</em> Identify the smallest set of tests producing most of the total time.<br/><em>Use it to:</em> Optimize tests before the cumulative line crosses ~80%. Anything after offers diminishing returns. Consider parallelizing or refactoring top contributors.<br/><em>Axes:</em> X = Tests sorted by duration (desc, truncated names). Left Y = Duration (ms). Right Y = Cumulative % of total time.',
          chart4: '<strong style="font-size:12px;">Function Total Time</strong><br/><em>Goal:</em> Surface functions consuming the most inclusive time across all calls.<br/><em>Use it to:</em> Start optimization with the tallest bars; check if they are called too often, do redundant work, or can be cached.<br/><em>Axes:</em> X = Function (truncated). Y = Total inclusive time (ms).',
          chart5: '<strong style="font-size:12px;">Function Bubble (Avg vs Calls)</strong><br/><em>Goal:</em> Balance frequency vs per-call cost to prioritize fixes with high payoff.<br/><em>Use it to:</em> Large & far-right bubbles (high avg & many calls) = prime optimization targets. High avg but few calls → micro-optimization likely low impact.<br/><em>Axes:</em> X = Average time per call (ms). Y = Call count. Bubble size = Total time (ms).',
          chart6: '<strong style="font-size:12px;">Function Cumulative Share</strong><br/><em>Goal:</em> Measure concentration of function time to see if performance is dominated by a few functions.<br/><em>Use it to:</em> Steep initial rise → focus on first handful. Flat line early → time is fragmented (look for systemic improvements).<br/><em>Axes:</em> X = Functions sorted by total time (desc). Y = Cumulative % of total function time.',
          chart7: '<strong style="font-size:12px;">Function Calls</strong><br/><em>Goal:</em> Identify hot call sites even if each call is cheap.<br/><em>Use it to:</em> Very high call counts can justify batching, memoization, or moving work out of loops. Combine with bubble chart to judge impact.<br/><em>Axes:</em> X = Function (truncated). Y = Number of calls.',
          chart8: '<strong style="font-size:12px;">Function Errors</strong><br/><em>Goal:</em> Track functions producing runtime errors (if instrumentation captures them).<br/><em>Use it to:</em> Errors in high time or high call functions should be prioritized; may hide retries or degraded performance paths.<br/><em>Axes:</em> X = Function (truncated). Y = Error count.',
          chart9: '<strong style="font-size:12px;">Duration Percentiles</strong><br/><em>Goal:</em> Understand latency distribution extremes vs median.<br/><em>Use it to:</em> Large gap between P50 and P95/P99 indicates tail latency issues (flaky dependencies, contention). Closing tail improves stability perception.<br/><em>Axes:</em> X = Percentile (Pn). Y = Duration (ms).'
        };
        const descEl = document.getElementById('chart-active-desc');
        // auto init first tab
        buildChart0();
        document.querySelectorAll('.tab-btn').forEach(btn=>{
          btn.addEventListener('click',()=>{
            const id = btn.getAttribute('data-chart-tab');
            document.querySelectorAll('.tab-panel').forEach(p=>p.style.display='none');
            document.getElementById('panel-'+id).style.display='block';
            if(descEl && descMap[id]) descEl.innerHTML = descMap[id];
            if(!chartsInited[id]){
              const buildFn = chartBuilders[id];
              if(buildFn) buildFn();
              chartsInited[id]=true;
            }
          });
        });
      }
      function percentile(arr,p){ if(!arr.length) return 0; const sorted=[...arr].sort((a,b)=>a-b); const idx=(p/100)*(sorted.length-1); const lo=Math.floor(idx); const hi=Math.ceil(idx); if(lo===hi) return sorted[lo]; const w=idx-lo; return sorted[lo]*(1-w)+sorted[hi]*w; }
  const durations = _testData.map(t=>t.duration);
  if(!_testData.length){ console.warn('[PerfReport HTML] No test data rows available for charts.'); }
  if(!_fnData.length){ console.warn('[PerfReport HTML] No function data rows available for charts.'); }
      const memory = _testData.map(t=>t.memoryMB);
      const fnTotal = _fnData.map(f=>f.totalTime);

      function buildChart0(){ // Histogram
        if(!durations.length){ const ctx=document.getElementById('chart0').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No test duration data',20,40); return; }
        const bins = [0,20,40,60,80,100,150,200,300,500];
        const counts = bins.slice(0,-1).map((b,i)=>durations.filter(d=>d>=b && d<bins[i+1]).length);
  charts.chart0 = new Chart(document.getElementById('chart0'), {type:'bar', data:{labels:bins.slice(0,-1).map((b,i)=> b + '-' + (bins[i+1]-1)), datasets:[{label:'Tests in bucket', data:counts, backgroundColor:'#007acc66'}]}, options:{plugins:{legend:{display:false}}, scales:{x:{title:{display:true, text:'Duration bucket (ms)'}}, y:{beginAtZero:true, title:{display:true, text:'Number of tests'}}}}});
        chartsInited.chart0=true;
      }
      function buildChart1(){ // Execution order line
        if(!durations.length){ const ctx=document.getElementById('chart1').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No test duration data',20,40); return; }
    charts.chart1 = new Chart(document.getElementById('chart1'), {type:'line', data:{labels:_testData.map((_,i)=>i+1), datasets:[{label:'Duration (ms)', data:durations, borderColor:'#28a745', tension:.2, fill:false}]}, options:{scales:{x:{title:{display:true, text:'Execution order (index)'}}, y:{beginAtZero:true, title:{display:true, text:'Duration (ms)'}}}}});
      }
      function buildChart2(){ // Duration vs Memory scatter
        if(!_testData.length){ const ctx=document.getElementById('chart2').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No test data',20,40); return; }
        charts.chart2 = new Chart(document.getElementById('chart2'), {type:'scatter', data:{datasets:[{label:'Test', data:_testData.map(t=>({x:t.duration,y:t.memoryMB})), backgroundColor:'#ff9800'}]}, options:{scales:{x:{title:{text:'Duration (ms)',display:true}}, y:{title:{text:'Peak heap (MB)',display:true}}}}});
      }
      function buildChart3(){ // Test Pareto
        if(!_testData.length){ const ctx=document.getElementById('chart3').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No test data',20,40); return; }
        const sorted = [..._testData].sort((a,b)=>b.duration-a.duration); const cum=[]; let run=0; const total=sorted.reduce((a,b)=>a+b.duration,0); sorted.forEach(t=>{run+=t.duration; cum.push((run/total*100).toFixed(1));});
    charts.chart3 = new Chart(document.getElementById('chart3'), {data:{labels:sorted.map(t=>t.name.substring(0,20)), datasets:[{type:'bar', label:'Duration', data:sorted.map(t=>t.duration), backgroundColor:'#2196f366', yAxisID:'y'},{type:'line', label:'Cumulative %', data:cum, borderColor:'#e91e63', yAxisID:'y1'}]}, options:{scales:{x:{title:{display:true,text:'Tests (sorted desc by duration)'}}, y:{beginAtZero:true, title:{text:'Duration (ms)',display:true}}, y1:{beginAtZero:true, min:0, max:100, position:'right', grid:{drawOnChartArea:false}, title:{text:'Cumulative % of total time',display:true}}}}});
      }
      function buildChart4(){ // Function total time bar
        if(!_fnData.length){ const ctx=document.getElementById('chart4').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No function data',20,40); return; }
        const sorted=[..._fnData].sort((a,b)=>b.totalTime-a.totalTime).slice(0,20);
    charts.chart4 = new Chart(document.getElementById('chart4'), {type:'bar', data:{labels:sorted.map(f=>f.name.substring(0,18)), datasets:[{label:'Total (ms)', data:sorted.map(f=>f.totalTime.toFixed(2)), backgroundColor:'#673ab766'}]}, options:{scales:{x:{title:{display:true,text:'Function (top 20 by total time)'}}, y:{beginAtZero:true,title:{display:true,text:'Total inclusive time (ms)'}}}}});
      }
      function buildChart5(){ // Function bubble avg vs calls sized by total
        if(!_fnData.length){ const ctx=document.getElementById('chart5').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No function data',20,40); return; }
  charts.chart5 = new Chart(document.getElementById('chart5'), {type:'bubble', data:{datasets:[{label:'Functions', data:_fnData.map(f=>({x:f.avgTime,y:f.calls,r:Math.max(4,Math.sqrt(f.totalTime)/4), name:f.name, total:f.totalTime})), backgroundColor:'#00968888'}]}, options:{scales:{x:{title:{text:'Average time per call (ms)',display:true}}, y:{title:{text:'Call count',display:true}}}, plugins:{tooltip:{callbacks:{label:(ctx)=> ctx.raw.name + ': avg=' + ctx.raw.x.toFixed(2) + 'ms calls=' + ctx.raw.y + ' total=' + ctx.raw.total.toFixed(2) + 'ms'}}}}});
      }
      function buildChart6(){ // Cumulative function time
        if(!_fnData.length){ const ctx=document.getElementById('chart6').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No function data',20,40); return; }
        const sorted=[..._fnData].sort((a,b)=>b.totalTime-a.totalTime); let run=0; const total=sorted.reduce((a,b)=>a+b.totalTime,0); const cum=sorted.map(f=>{run+=f.totalTime; return (run/total*100).toFixed(1)});
    charts.chart6 = new Chart(document.getElementById('chart6'), {type:'line', data:{labels:sorted.map(f=>f.name.substring(0,18)), datasets:[{label:'Cumulative %', data:cum, borderColor:'#3f51b5'}]}, options:{scales:{x:{title:{display:true,text:'Functions (sorted by total time)'}}, y:{beginAtZero:true, max:100, title:{display:true,text:'Cumulative % of total function time'}}}}});
      }
      function buildChart7(){ // Function calls distribution
        if(!_fnData.length){ const ctx=document.getElementById('chart7').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No function data',20,40); return; }
        const sorted=[..._fnData].sort((a,b)=>b.calls-a.calls).slice(0,20);
    charts.chart7 = new Chart(document.getElementById('chart7'), {type:'bar', data:{labels:sorted.map(f=>f.name.substring(0,18)), datasets:[{label:'Calls', data:sorted.map(f=>f.calls), backgroundColor:'#79554888'}]}, options:{scales:{x:{title:{display:true,text:'Function (top 20 by calls)'}}, y:{beginAtZero:true, title:{display:true,text:'Call count'}}}}});
      }
      function buildChart8(){ // Function errors (only those with errors)
        const errs=_fnData.filter(f=>f.errors>0); if(!errs.length){ const ctx=document.getElementById('chart8').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No function errors recorded',20,40); return; }
    charts.chart8 = new Chart(document.getElementById('chart8'), {type:'bar', data:{labels:errs.map(f=>f.name.substring(0,18)), datasets:[{label:'Errors', data:errs.map(f=>f.errors), backgroundColor:'#f4433677'}]}, options:{scales:{x:{title:{display:true,text:'Function (errors only)'}}, y:{beginAtZero:true, title:{display:true,text:'Error count'}}}}});
      }
      function buildChart9(){ // Duration percentiles line
        if(!durations.length){ const ctx=document.getElementById('chart9').getContext('2d'); ctx.font='14px sans-serif'; ctx.fillStyle='#666'; ctx.fillText('No test duration data',20,40); return; }
        const pts=[0,10,25,50,75,90,95,99,100]; const line=pts.map(p=>percentile(durations,p).toFixed(1));
    charts.chart9 = new Chart(document.getElementById('chart9'), {type:'line', data:{labels:pts.map(p=>'P'+p), datasets:[{label:'Duration (ms)', data:line, borderColor:'#ff5722'}]}, options:{scales:{x:{title:{display:true,text:'Percentile'}}, y:{beginAtZero:true,title:{display:true,text:'Duration (ms)'}}}}});
      }
      const chartBuilders = {chart0:buildChart0, chart1:buildChart1, chart2:buildChart2, chart3:buildChart3, chart4:buildChart4, chart5:buildChart5, chart6:buildChart6, chart7:buildChart7, chart8:buildChart8, chart9:buildChart9};

    </script>
</body>
</html>`;

    const filePath = path.join(this.outputDir, 'performance-report.html');
    fs.writeFileSync(filePath, html);
    console.log(`🌐 HTML Report: ${filePath}`);
    console.log(`   Open in browser: file://${filePath}`);
  }

  printSummary(report) {
    console.log('\n🏁 Performance Test Summary:');
    console.log(`⏱️  Total Duration: ${(report.metadata.totalDuration / 1000).toFixed(2)}s`);
    console.log(`📊 Average Test: ${report.summary.averageDuration.toFixed(2)}ms`);
    console.log(`🐌 Slow Tests: ${report.summary.slowTests}`);
    console.log(`💾 Peak Memory: ${(report.memoryProfile.peak / 1024 / 1024).toFixed(2)} MB`);

    if (report.slowestTests.length > 0) {
      console.log('\n🔥 Top 3 Slowest Tests:');
      report.slowestTests.slice(0, 3).forEach((test, i) => {
        console.log(`   ${i + 1}. ${test.testName}: ${test.duration}ms`);
      });
    }
    if (report.functions && report.functions.length) {
      console.log('\n🧠 Top 10 Slowest Functions (avg ms):');
      report.hottestFunctions.slice(0, 10).forEach((fn, i) => {
        console.log(
          `   ${String(i + 1).padStart(2, ' ')}. ${fn.name} avg=${fn.avgTime.toFixed(2)}ms calls=${fn.calls} total=${fn.totalTime.toFixed(2)}ms max=${fn.max.toFixed(2)}ms`
        );
      });
    }
  }

  escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case "'":
          return '&apos;';
        case '"':
          return '&quot;';
      }
    });
  }
}

module.exports = JestPerformanceReporter;
