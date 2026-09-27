// Judging progress: pure helpers behind the organizer's live dashboard.
//
// A judge is a *straggler* when finishing on time looks unlikely:
//   - judging has closed and they still owe reviews ("missed"),
//   - they are more than BEHIND_TOLERANCE behind a steady pace ("behind"), where a steady pace
//     means the share of the judging window that has elapsed, or
//   - a fifth of the window is gone and they haven't opened a single project ("not_started").
// The tolerance is deliberately generous: most judges review in bursts, and nagging someone
// who is two reviews behind on day one helps nobody.
import type { JudgingWindow } from "../policy";

export const BEHIND_TOLERANCE = 0.2;
export const NOT_STARTED_AFTER = 0.2;

export type Pace = "unassigned" | "waiting" | "done" | "on_track" | "behind" | "not_started" | "missed";

export type JudgeCounts = {
  active: number; // assignments that aren't recused
  submitted: number;
  started: boolean; // opened a project, saved a draft or submitted anything
};

/** Share of the judging window that has elapsed, in [0, 1], or null when there's no end date. */
export function elapsedFraction(opensAt: Date, closesAt: Date | null, now: Date): number | null {
  if (!closesAt) return null;
  const span = closesAt.getTime() - opensAt.getTime();
  if (span <= 0) return now >= closesAt ? 1 : 0;
  return Math.min(1, Math.max(0, (now.getTime() - opensAt.getTime()) / span));
}

export function assessJudge(c: JudgeCounts, window: JudgingWindow, elapsed: number | null): { pace: Pace; straggler: boolean } {
  if (c.active === 0) return { pace: "unassigned", straggler: false };
  if (c.submitted >= c.active) return { pace: "done", straggler: false };
  if (window === "not_open") return { pace: "waiting", straggler: false };
  if (window === "closed") return { pace: "missed", straggler: true };
  if (!c.started) return { pace: "not_started", straggler: elapsed !== null && elapsed >= NOT_STARTED_AFTER };
  if (elapsed !== null && c.submitted / c.active < elapsed - BEHIND_TOLERANCE) return { pace: "behind", straggler: true };
  return { pace: "on_track", straggler: false };
}

/**
 * Cumulative count of events (submitted reviews) at evenly spaced points from `from` to `to`.
 * Events before `from` count from the start; events after `to` are ignored.
 */
export function cumulativeSeries(times: Date[], from: Date, to: Date, points = 24): Array<{ t: string; n: number }> {
  const start = from.getTime();
  const end = Math.max(to.getTime(), start + 1);
  const sorted = times.map((d) => d.getTime()).sort((a, b) => a - b);
  const out: Array<{ t: string; n: number }> = [];
  let i = 0;
  for (let k = 0; k < points; k++) {
    const at = start + ((end - start) * k) / (points - 1);
    while (i < sorted.length && sorted[i]! <= at) i++;
    out.push({ t: new Date(at).toISOString(), n: i });
  }
  return out;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
