import { Search } from "lucide-react";
import type { EventSummary } from "@/lib/types";
import { phaseOf, type Phase } from "@/lib/phase";
import { EventCard } from "@/components/EventCard";
import { Chip, EmptyState, inputClass } from "@/components/ui";

export const TABS: Array<{ key: string; label: string; phases: Phase[] }> = [
  { key: "all", label: "All", phases: ["upcoming", "registration", "submissions", "judging", "ended"] },
  { key: "open", label: "Open now", phases: ["registration", "submissions"] },
  { key: "upcoming", label: "Upcoming", phases: ["upcoming"] },
  { key: "judging", label: "In judging", phases: ["judging"] },
  { key: "ended", label: "Ended", phases: ["ended"] },
];

/** Search box, status chips and the event list. `path` is where the filters link to ("/hackathons" or "/"). */
export function HackathonBrowser({ events, status, q, path, anchor = "" }: { events: EventSummary[]; status: string; q: string; path: string; anchor?: string }) {
  const tab = TABS.find((t) => t.key === status) ?? TABS[0]!;
  const needle = q.trim().toLowerCase();
  const withPhase = events.map((e) => ({ e, p: phaseOf(e) }));
  const order: Record<Phase, number> = { submissions: 0, registration: 1, upcoming: 2, judging: 3, ended: 4 };
  const shown = withPhase
    .filter(({ p }) => tab.phases.includes(p.phase))
    .filter(({ e }) => !needle || [e.name, e.tagline, e.description, ...e.tracks].join(" ").toLowerCase().includes(needle))
    .sort((a, b) => order[a.p.phase] - order[b.p.phase]);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, withPhase.filter(({ p }) => t.phases.includes(p.phase)).length]));
  const qs = (next: Record<string, string>) => {
    const u = new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(q ? { q } : {}), ...next });
    for (const [k, v] of [...u]) if (!v || (k === "status" && v === "all")) u.delete(k);
    const s = u.toString();
    return `${path}${s ? `?${s}` : ""}${anchor}`;
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Chip key={t.key} href={qs({ status: t.key })} active={t.key === tab.key}>
              {t.label}
              <span className={`rounded-full px-1.5 text-[11px] ${t.key === tab.key ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{counts[t.key]}</span>
            </Chip>
          ))}
        </div>
        <form action={`${path}${anchor}`} className="relative w-full sm:w-80">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search hackathons or tracks" className={`${inputClass} pl-10`} />
        </form>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="No hackathons match">
          {needle ? "Try another search." : "Nothing here yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {shown.map(({ e }) => (
            <EventCard key={e.slug} e={e} />
          ))}
        </div>
      )}
    </>
  );
}
