/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface JsonTreeProps {
  data: any;
}

export function JsonTree({ data }: JsonTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderValue = (value: any, key: string, path: string): JSX.Element => {
    if (value === null) {
      return <span className="text-muted-foreground">null</span>;
    }

    if (value === undefined) {
      return <span className="text-muted-foreground">undefined</span>;
    }

    if (typeof value === 'string') {
      return <span className="text-green-600">&quot;{value}&quot;</span>;
    }

    if (typeof value === 'number') {
      return <span className="text-blue-600">{value}</span>;
    }

    if (typeof value === 'boolean') {
      return <span className="text-purple-600">{value.toString()}</span>;
    }

    if (Array.isArray(value)) {
      const isExpanded = expanded.has(path);
      return (
        <div>
          <button
            onClick={() => toggleExpand(path)}
            className="inline-flex items-center gap-1 hover:bg-accent px-1 rounded"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="text-muted-foreground">[{value.length}]</span>
          </button>
          {isExpanded && (
            <div className="ml-4 mt-1 space-y-1">
              {value.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-muted-foreground">{index}:</span>
                  {renderValue(item, String(index), `${path}.${index}`)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      const isExpanded = expanded.has(path);
      return (
        <div>
          <button
            onClick={() => toggleExpand(path)}
            className="inline-flex items-center gap-1 hover:bg-accent px-1 rounded"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="text-muted-foreground">{'{'}{keys.length}{'}'}</span>
          </button>
          {isExpanded && (
            <div className="ml-4 mt-1 space-y-1">
              {keys.map(k => (
                <div key={k} className="flex gap-2">
                  <span className="font-medium">{k}:</span>
                  {renderValue(value[k], k, `${path}.${k}`)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return <span>{String(value)}</span>;
  };

  if (typeof data !== 'object' || data === null) {
    return <div className="font-mono text-sm">{renderValue(data, 'root', 'root')}</div>;
  }

  const keys = Object.keys(data);

  return (
    <div className="font-mono text-sm space-y-1">
      {keys.map(key => (
        <div key={key} className="flex gap-2">
          <span className="font-medium">{key}:</span>
          {renderValue(data[key], key, key)}
        </div>
      ))}
    </div>
  );
}
