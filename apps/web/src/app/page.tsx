import Link from "next/link";
import { ArrowRight, Gavel, Layers, ShieldCheck, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { EventSummary } from "@/lib/types";
import { phaseOf } from "@/lib/phase";
import { HackathonBrowser } from "@/components/HackathonBrowser";
import { buttonClass } from "@/components/ui";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = "all", q = "" } = await searchParams;
  const [{ events }, me] = await Promise.all([api<{ events: EventSummary[] }>("/api/events"), getMe()]);

  const open = events.filter((e) => ["registration", "submissions"].includes(phaseOf(e).phase)).length;
  const totals = {
    hackathons: events.length,
    projects: events.reduce((n, e) => n + e.projectCount, 0),
    builders: events.reduce((n, e) => n + e.participantCount, 0),
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
              <span className="size-1.5 rounded-full bg-[#ff8a5b]" /> Open source · self-hosted
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] sm:text-6xl">
              Build it. Ship it.
              <br />
              <span className="bg-gradient-to-r from-[#8e9bff] via-[#c2a8ff] to-[#ff9a6b] bg-clip-text text-transparent">Get judged fairly.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/70">
              Join a hackathon, team up, ship before the deadline. Organizers get fair judging and results you can
              defend.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="#hackathons" className={buttonClass("accent", "lg")}>
                Explore hackathons <ArrowRight className="size-4" />
              </Link>
              <Link href={me.user ? "/events/new" : "/register"} className={buttonClass("secondary", "lg", "border-white/20 bg-white/5 text-white hover:bg-white/10")}>
                {me.user ? "Host a hackathon" : "Create a free account"}
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {[
              { icon: <Trophy className="size-5" />, value: totals.hackathons, label: "Hackathons hosted" },
              { icon: <Layers className="size-5" />, value: totals.projects, label: "Projects submitted" },
              { icon: <ShieldCheck className="size-5" />, value: totals.builders, label: "Builders registered" },
              { icon: <Gavel className="size-5" />, value: open, label: "Open right now" },
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
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-3xl font-extrabold">Find your next build</h2>
          <Link href="/hackathons" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            All hackathons <ArrowRight className="size-4" />
          </Link>
        </div>
        <HackathonBrowser events={events} status={status} q={q} path="/" anchor="#hackathons" />
      </section>
    </>
  );
}
