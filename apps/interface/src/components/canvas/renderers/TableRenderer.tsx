'use client';

import React, { useMemo, useState } from 'react';
import type { TableContent } from '../types';

interface Props {
  content: TableContent;
}

type SortDir = 'asc' | 'desc' | null;

export default function TableRenderer({ content }: Props) {
  const { data } = content;
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey || !sortDir) return data.rows;
    return [...data.rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [data.rows, sortKey, sortDir]);

  const getSortIndicator = (key: string) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : sortDir === 'desc' ? ' ↓' : '';
  };

  return (
    <div className="canvas-table px-6 py-4">
      {content.title && (
        <h2 className="text-xl font-bold text-slate-100 mb-4">{content.title}</h2>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-700/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80">
              {data.columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-3 font-semibold text-slate-200 border-b border-slate-700 whitespace-nowrap ${
                    col.sortable !== false ? 'cursor-pointer hover:text-indigo-300 select-none' : ''
                  } text-${col.align || 'left'}`}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  {col.label}{getSortIndicator(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
              >
                {data.columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-4 py-2.5 text-slate-300 text-${col.align || 'left'}`}
                  >
                    {row[col.key] != null ? String(row[col.key]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-slate-500 mt-2">{data.rows.length} rows</div>
    </div>
  );
}
