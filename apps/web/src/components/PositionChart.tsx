import type { PositionCheck } from "@/lib/types";

/**
 * Picks by the position a project was shown at on each voter's shuffled ballot, against what an
 * order-blind crowd would produce. Bars near the dashed marks = position didn't matter.
 */
export function PositionChart({ check }: { check: PositionCheck }) {
  const max = Math.max(1, ...check.buckets.flatMap((b) => [b.observed, b.expected]));
  return (
    <figure>
      <div className="flex h-40 items-end gap-3" role="img" aria-label="Picks by ballot position compared with an order-blind crowd">
        {check.buckets.map((b) => (
          <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-xs font-semibold tabular-nums">{b.observed}</span>
            <div className="relative w-full flex-1">
              <div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-primary/80" style={{ height: `${(b.observed / max) * 100}%` }} />
              <div className="absolute inset-x-[-4px] border-t-2 border-dashed border-ink/60" style={{ bottom: `${(b.expected / max) * 100}%` }} title={`Expected about ${b.expected}`} />
            </div>
            <span className="text-[11px] font-medium text-muted">{b.label}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary/80" /> Picks for projects shown at these positions
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-ink/60" /> If position made no difference
        </span>
      </figcaption>
    </figure>
  );
}

export function positionVerdict(c: PositionCheck): { tone: "success" | "warn" | "neutral"; text: string } {
  if (!c.enoughData) return { tone: "neutral", text: `Too few picks (${c.picks}) to test whether position mattered.` };
  if (c.positionEffect)
    return { tone: "warn", text: `Position seems to have mattered (χ² = ${c.chi2}, above ${c.critical} at 99% confidence). Treat close results with care.` };
  return { tone: "success", text: `No sign that list position mattered (χ² = ${c.chi2} with ${c.df} degrees of freedom, below ${c.critical} at 99% confidence).` };
}
