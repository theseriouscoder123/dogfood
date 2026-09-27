import Link from "next/link";
import { ArrowRight, Gavel, Layers, Search, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { EventSummary } from "@/lib/types";
import { phaseOf, type Phase } from "@/lib/phase";
import { EventCard } from "@/components/EventCard";
import { buttonClass, Chip, EmptyState, inputClass } from "@/components/ui";

const TABS: Array<{ key: string; label: string; phases: Phase[] }> = [
  { key: "all", label: "All", phases: ["upcoming", "registration", "submissions", "judging", "ended"] },
  { key: "open", label: "Open now", phases: ["registration", "submissions"] },
  { key: "upcoming", label: "Upcoming", phases: ["upcoming"] },
  { key: "judging", label: "In judging", phases: ["judging"] },
  { key: "ended", label: "Ended", phases: ["ended"] },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = "all", q = "" } = await searchParams;
  const [{ events }, me] = await Promise.all([api<{ events: EventSummary[] }>("/api/events"), getMe()]);

  const tab = TABS.find((t) => t.key === status) ?? TABS[0]!;
  const needle = q.trim().toLowerCase();
  const withPhase = events.map((e) => ({ e, p: phaseOf(e) }));
  const order: Record<Phase, number> = { submissions: 0, registration: 1, upcoming: 2, judging: 3, ended: 4 };
  const shown = withPhase
    .filter(({ p }) => tab.phases.includes(p.phase))
    .filter(({ e }) => !needle || [e.name, e.tagline, e.description, ...e.tracks].join(" ").toLowerCase().includes(needle))
    .sort((a, b) => order[a.p.phase] - order[b.p.phase]);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, withPhase.filter(({ p }) => t.phases.includes(p.phase)).length]));

  const totals = {
    hackathons: events.length,
    projects: events.reduce((n, e) => n + e.projectCount, 0),
    builders: events.reduce((n, e) => n + e.participantCount, 0),
  };
  const qs = (next: Record<string, string>) => {
    const u = new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(q ? { q } : {}), ...next });
    for (const [k, v] of [...u]) if (!v || (k === "status" && v === "all")) u.delete(k);
    const s = u.toString();
    return s ? `/?${s}#hackathons` : "/#hackathons";
  };

  return (
    <>
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-hero text-hero-ink">
        <div className="hero-grid absolute inset-0" />
        <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-[#3346f0] opacity-40 blur-[120px]" />
        <div className="absolute -right-32 top-10 size-[420px] rounded-full bg-[#ff6b35] opacity-25 blur-[120px]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur">
              <Sparkles className="size-3.5 text-[#ff8a5b]" /> Open source · self-hosted · no vendor lock-in
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] sm:text-6xl">
              Build it. Ship it.
              <br />
              <span className="bg-gradient-to-r from-[#8e9bff] via-[#c2a8ff] to-[#ff9a6b] bg-clip-text text-transparent">Get judged fairly.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/70">
              Join a hackathon, form your team with a link, submit before the buzzer. Organizers get weighted rubrics, isolated judging and results you can
              defend.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="#hackathons" className={buttonClass("accent", "lg")}>
                Explore hackathons <ArrowRight className="size-4" />
              </Link>
              {me.user?.isAdmin ? (
                <Link href="/events/new" className={buttonClass("secondary", "lg", "border-white/20 bg-white/5 text-white hover:bg-white/10")}>
                  Host a hackathon
                </Link>
              ) : !me.user ? (
                <Link href="/register" className={buttonClass("secondary", "lg", "border-white/20 bg-white/5 text-white hover:bg-white/10")}>
                  Create a free account
                </Link>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {[
              { icon: <Trophy className="size-5" />, value: totals.hackathons, label: "Hackathons hosted" },
              { icon: <Layers className="size-5" />, value: totals.projects, label: "Projects submitted" },
              { icon: <ShieldCheck className="size-5" />, value: totals.builders, label: "Builders registered" },
              { icon: <Gavel className="size-5" />, value: counts.open ?? 0, label: "Open right now" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
                <div className="mb-4 grid size-10 place-items-center rounded-xl bg-white/10 text-white">{s.icon}</div>
                <div className="font-display text-3xl font-extrabold">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</div>
                <div className="mt-0.5 text-sm text-white/60">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── listing ──────────────────────────────────────────────────────── */}
      <section id="hackathons" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-12 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">Hackathons</p>
            <h2 className="text-3xl font-extrabold">Find your next build</h2>
          </div>
          <form action="/#hackathons" className="relative w-full sm:w-80">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={q} placeholder="Search hackathons or tracks" className={`${inputClass} pl-10`} />
          </form>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Chip key={t.key} href={qs({ status: t.key })} active={t.key === tab.key}>
              {t.label}
              <span className={`rounded-full px-1.5 text-[11px] ${t.key === tab.key ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{counts[t.key]}</span>
            </Chip>
          ))}
        </div>

        {shown.length === 0 ? (
          <EmptyState icon={<Search className="size-5" />} title="No hackathons match">
            Try another filter{needle ? " or clear your search" : ""}.
          </EmptyState>
        ) : (
          <div className="grid gap-4">
            {shown.map(({ e }) => (
              <EventCard key={e.slug} e={e} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
