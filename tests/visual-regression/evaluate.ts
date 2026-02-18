/**
 * Screenshot evaluator — generates an HTML report from test results.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ReportEntry {
  testName: string;
  toolName: string;
  passed: boolean;
  screenshotPath: string;
  httpStatus: number;
  consoleErrors: string[];
  durationMs: number;
  note?: string;
}

const entries: ReportEntry[] = [];

export function addEntry(e: ReportEntry) {
  entries.push(e);
}

export function generateReport(outputPath?: string) {
  const reportPath = outputPath ?? path.resolve(__dirname, 'report.html');
  const screenshotsDir = path.resolve(__dirname, 'screenshots');

  const rows = entries
    .map((e) => {
      const relScreenshot = path.relative(path.dirname(reportPath), e.screenshotPath);
      const statusBadge = e.passed
        ? '<span style="color:green;font-weight:bold">✅ PASS</span>'
        : '<span style="color:red;font-weight:bold">❌ FAIL</span>';
      const errorsHtml = e.consoleErrors.length
        ? `<pre style="color:red;font-size:12px;max-height:150px;overflow:auto">${escapeHtml(e.consoleErrors.join('\n'))}</pre>`
        : '<span style="color:gray">none</span>';
      return `
      <tr>
        <td>${escapeHtml(e.testName)}</td>
        <td><code>${escapeHtml(e.toolName)}</code></td>
        <td>${statusBadge}</td>
        <td>${e.httpStatus}</td>
        <td>${e.durationMs}ms</td>
        <td>${errorsHtml}</td>
        <td>${e.note ? escapeHtml(e.note) : ''}</td>
        <td><a href="${relScreenshot}" target="_blank"><img src="${relScreenshot}" style="max-width:300px;max-height:180px;border:1px solid #ccc" /></a></td>
      </tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>PearlOS Visual Regression Report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #f5f5f5; }
  h1 { color: #333; }
  table { border-collapse: collapse; width: 100%; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; vertical-align: top; }
  th { background: #667eea; color: white; }
  tr:nth-child(even) { background: #f9f9f9; }
  .summary { margin: 16px 0; padding: 12px; background: white; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
</style></head><body>
<h1>🐚 PearlOS Visual Regression Report</h1>
<div class="summary">
  <strong>Generated:</strong> ${new Date().toISOString()}<br>
  <strong>Total:</strong> ${entries.length} |
  <strong style="color:green">Passed:</strong> ${entries.filter((e) => e.passed).length} |
  <strong style="color:red">Failed:</strong> ${entries.filter((e) => !e.passed).length}
</div>
<table>
<thead><tr><th>Test</th><th>Tool</th><th>Status</th><th>HTTP</th><th>Duration</th><th>Console Errors</th><th>Notes</th><th>Screenshot</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body></html>`;

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, html);
  console.log(`Report written to ${reportPath}`);
  return reportPath;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { entries };
