"use client";
import React from 'react';

// Brightened colors for improved contrast in both light & dark themes.
// Using slightly higher background opacity and lighter text in dark mode.
const roleColors: Record<string,string> = {
  owner: 'bg-purple-500/25 dark:bg-purple-500/35 text-purple-700 dark:text-purple-200 border-purple-500/50 dark:border-purple-400',
  admin: 'bg-blue-500/25 dark:bg-blue-500/35 text-blue-700 dark:text-blue-200 border-blue-500/50 dark:border-blue-400',
  member: 'bg-green-500/25 dark:bg-green-600/35 text-green-700 dark:text-green-200 border-green-500/50 dark:border-green-400',
  viewer: 'bg-gray-500/25 dark:bg-gray-500/35 text-gray-700 dark:text-gray-200 border-gray-500/50 dark:border-gray-400'
};

export const RoleBadge: React.FC<{ role?: string; inactive?: boolean }> = ({ role, inactive }) => {
  if (!role) return <span className="text-xs text-muted-foreground">—</span>;
  const cls = roleColors[role] || 'bg-gray-400/25 dark:bg-gray-400/30 text-gray-700 dark:text-gray-200 border-gray-400/60';
  return <span className={`inline-block text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide ${cls} ${inactive ? 'opacity-50 line-through' : ''}`}>{role}</span>;
};
