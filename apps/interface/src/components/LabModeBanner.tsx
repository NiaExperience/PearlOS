'use client';

import { useState, useEffect } from 'react';

const FONT = { fontFamily: 'Gohufont, monospace' } as const;

export function LabModeBanner() {
  const [active, setActive] = useState(false);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await fetch('/api/bot/lab-mode', { signal: AbortSignal.timeout(3000) });
        if (res.ok && mounted) {
          const data = await res.json();
          setActive(data.active === true);
        }
      } catch {}
    };
    check();
    const interval = setInterval(check, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const handleRevert = async () => {
    setReverting(true);
    try {
      const res = await fetch('/api/bot/lab-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate' }),
      });
      if (res.ok) setActive(false);
    } catch {} finally {
      setReverting(false);
    }
  };

  if (!active) return null;

  return (
    <div
      className="w-full px-4 py-1.5 flex items-center justify-center gap-3 z-[9999] relative"
      style={{
        ...FONT,
        background: 'linear-gradient(90deg, rgba(245,158,11,0.15) 0%, rgba(245,158,11,0.25) 50%, rgba(245,158,11,0.15) 100%)',
        borderBottom: '1px solid rgba(245,158,11,0.3)',
        fontSize: '12px',
      }}
    >
      <span className="text-amber-400">⚠️ Lab Mode Active — Changes are experimental</span>
      <button
        onClick={handleRevert}
        disabled={reverting}
        className="px-2 py-0.5 rounded text-[11px] bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
        style={FONT}
      >
        {reverting ? 'Reverting...' : 'Revert'}
      </button>
    </div>
  );
}
