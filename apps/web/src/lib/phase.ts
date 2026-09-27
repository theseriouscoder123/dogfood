// Where an event is in its lifecycle, derived from its dates. Used for status pills,
// countdowns and the "what should I do now" call to action.
export type Phase = "upcoming" | "registration" | "submissions" | "judging" | "ended";

type Dates = {
  registrationOpensAt: string | null;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  judgingClosesAt: string | null;
};

export function phaseOf(e: Dates, now = new Date()): { phase: Phase; label: string; tone: "primary" | "accent" | "success" | "warn" | "neutral"; countdownTo: string | null; countdownLabel: string } {
  const t = now.getTime();
  const reg = new Date(e.registrationOpensAt ?? e.submissionsOpenAt).getTime();
  const open = new Date(e.submissionsOpenAt).getTime();
  const close = new Date(e.submissionsCloseAt).getTime();
  const judgingEnd = e.judgingClosesAt ? new Date(e.judgingClosesAt).getTime() : null;

  if (t < reg) return { phase: "upcoming", label: "Upcoming", tone: "primary", countdownTo: new Date(reg).toISOString(), countdownLabel: "Registration opens in" };
  if (t < open) return { phase: "registration", label: "Registration open", tone: "success", countdownTo: e.submissionsOpenAt, countdownLabel: "Submissions open in" };
  if (t < close) return { phase: "submissions", label: "Open for submissions", tone: "accent", countdownTo: e.submissionsCloseAt, countdownLabel: "Submissions close in" };
  if (judgingEnd && t < judgingEnd) return { phase: "judging", label: "Judging", tone: "warn", countdownTo: e.judgingClosesAt, countdownLabel: "Judging ends in" };
  return { phase: "ended", label: "Ended", tone: "neutral", countdownTo: null, countdownLabel: "" };
}

/** "3 days left", "5 hours left", "ended". */
export function relativeLeft(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "ended";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.ceil(ms / 60_000)} min left`;
  if (h < 48) return `${Math.floor(h)} hours left`;
  return `${Math.floor(h / 24)} days left`;
}
