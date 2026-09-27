"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Live ticking countdown. Renders a stable placeholder on the server to avoid hydration mismatches. */
export function Countdown({ to, compact = false, onDark = false }: { to: string; compact?: boolean; onDark?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const p = parts(now === null ? 0 : new Date(to).getTime() - now);
  const cells: Array<[number, string]> = [
    [p.d, "days"],
    [p.h, "hrs"],
    [p.m, "min"],
    [p.s, "sec"],
  ];

  if (compact) {
    return (
      <span className="font-mono tabular-nums">
        {now === null ? "--" : `${p.d}d ${String(p.h).padStart(2, "0")}h ${String(p.m).padStart(2, "0")}m`}
      </span>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-2" role="timer" aria-live="off">
      {cells.map(([v, l]) => (
        <div key={l} className={`rounded-xl px-1 py-2 text-center ${onDark ? "bg-white/10" : "bg-surface-2"}`}>
          <div className={`font-display text-2xl font-bold tabular-nums ${onDark ? "text-white" : "text-ink"}`}>{now === null ? "--" : String(v).padStart(2, "0")}</div>
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${onDark ? "text-white/60" : "text-muted"}`}>{l}</div>
        </div>
      ))}
    </div>
  );
}
