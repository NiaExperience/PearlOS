import { config as loadEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

loadEnv({ path: '.env.local' });

const { Client } = pg;

const client = new Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'testdb',
});

function asCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    // Flatten JSON values into readable single-line text for table cells.
    return JSON.stringify(value).replace(/\s+/g, ' ');
  }
  return String(value);
}

function truncate(value, max = 80) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function pad(value, width) {
  const safe = value ?? '';
  return safe + ' '.repeat(Math.max(0, width - safe.length));
}

function renderAsciiTable(columns, rows) {
  const widths = columns.map((col, idx) => {
    const maxCell = rows.reduce((max, row) => {
      const v = row[idx] ?? '';
      return Math.max(max, v.length);
    }, 0);
    return Math.min(Math.max(col.length, maxCell), 80);
  });

  const sep = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const header = `| ${columns.map((col, i) => pad(col, widths[i])).join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell, i) => pad(truncate(cell, widths[i]), widths[i])).join(' | ')} |`);

  return [sep, header, sep, ...body, sep].join('\n');
}

async function main() {
  await client.connect();
  console.log('[db] connected');

  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);

  if (tables.rows.length === 0) {
    console.log('[db] no tables found in public schema');
    return;
  }

  const reportLines = [];
  reportLines.push('PostgreSQL Data Export');
  reportLines.push(`Generated at: ${new Date().toISOString()}`);
  reportLines.push('');

  const summaryRows = [];
  for (const row of tables.rows) {
    const table = row.table_name;
    reportLines.push(`=== TABLE: ${table} ===`);

    const countResult = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
    const rowCount = countResult.rows[0].count;
    summaryRows.push([table, String(rowCount)]);
    reportLines.push(`Rows: ${rowCount}`);

    const dataResult = await client.query(`SELECT * FROM "${table}"`);
    const rows = dataResult.rows;

    if (rows.length === 0) {
      reportLines.push('(no rows)');
      reportLines.push('');
      continue;
    }

    const columns = Object.keys(rows[0]);
    const tableRows = rows.map((r) => columns.map((c) => asCell(r[c])));
    reportLines.push(renderAsciiTable(columns, tableRows));
    reportLines.push('');
  }

  reportLines.unshift(renderAsciiTable(['table_name', 'row_count'], summaryRows), '');

  const outDir = path.resolve('exports');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `postgres-report-${Date.now()}.txt`);
  await fs.writeFile(outPath, reportLines.join('\n'), 'utf8');
  console.log(`[db] report written to ${outPath}`);
}

main()
  .catch((error) => {
    console.error('[db] failed to log postgres data:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
