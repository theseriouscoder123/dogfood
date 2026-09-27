import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, CircleDashed, Gavel, Keyboard, Lock, PenLine, UserX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { JudgeQueue } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Countdown } from "@/components/Countdown";
import { buttonClass, EmptyState, Pill } from "@/components/ui";
import { Cover } from "@/components/visuals";

export const metadata = { title: "Judging" };

const GROUPS = [
  { key: "todo", title: "To review", statuses: ["assigned"], icon: CircleDashed },
  { key: "progress", title: "In progress", statuses: ["in_progress"], icon: PenLine },
  { key: "done", title: "Submitted", statuses: ["submitted"], icon: CheckCircle2 },
  { key: "recused", title: "Recused", statuses: ["recused"], icon: UserX },
] as const;

export default async function JudgingDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getMe();
  if (!me.user) redirect(`/login?next=/events/${slug}/judging`);
  const data = await api<JudgeQueue>(`/api/events/${encodeURIComponent(slug)}/judging`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  });
  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-16">
        <EmptyState icon={<Gavel className="size-5" />} title="You're not judging this event" />
      </div>
    );
  }

  const { progress: p, judgingWindow: w } = data;
  const pct = p.total ? Math.round((p.submitted / p.total) * 100) : 0;
  const next = data.assignments.find((a) => a.status === "in_progress") ?? data.assignments.find((a) => a.status === "assigned");

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <Link href={`/events/${slug}`} className="text-sm font-semibold text-muted hover:text-ink">
        ← {data.event.name}
      </Link>

      {/* summary band */}
      <section className="relative mt-3 overflow-hidden rounded-3xl bg-hero p-6 text-hero-ink sm:p-8">
        <div className="hero-grid absolute inset-0" />
        <div className="absolute -right-24 -top-24 size-72 rounded-full bg-[#3346f0] opacity-40 blur-[90px]" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-white/60">Judging dashboard</p>
            <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">Hi {me.user.name.split(" ")[0]}, thanks for judging.</h1>
            <div className="mt-6 flex items-center gap-4">
              <div className="h-3 max-w-md flex-1 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gradient-to-r from-[#8e9bff] to-[#ff9a6b]" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-display text-2xl font-extrabold tabular-nums">{pct}%</span>
            </div>
            <p className="mt-2 text-sm text-white/70">
              {p.submitted} of {p.total} reviews submitted
              {p.inProgress > 0 && ` · ${p.inProgress} in progress`}
              {p.recused > 0 && ` · ${p.recused} recused`}
            </p>
            {w === "open" && next && (
              <Link href={`/events/${slug}/judging/${next.id}`} className={buttonClass("accent", "lg", "mt-6")}>
                {next.status === "in_progress" ? "Continue reviewing" : "Start next review"} <ArrowRight className="size-4" />
              </Link>
            )}
          </div>
          <div className="w-full rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur lg:w-80">
            {w === "open" && data.event.judgingClosesAt ? (
              <>
                <p className="mb-2 text-xs font-semibold text-white/60">Judging closes in</p>
                <Countdown to={data.event.judgingClosesAt} onDark />
              </>
            ) : w === "not_open" ? (
              <>
                <p className="mb-2 text-xs font-semibold text-white/60">Judging opens in</p>
                <Countdown to={data.event.judgingOpensAt} onDark />
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Lock className="size-4" /> {w === "closed" ? "Judging has closed. Your reviews are read-only." : "Judging is open with no end date."}
              </p>
            )}
            <p className="mt-4 flex items-start gap-2 text-xs text-white/60">
              <Keyboard className="mt-0.5 size-3.5 shrink-0" /> Score with number keys, move between criteria with ↑ ↓. Drafts save automatically.
            </p>
          </div>
        </div>
      </section>

      {data.criteria.length === 0 && (
        <p className="mt-6 rounded-xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">The organizers haven&apos;t published a rubric yet. You can read projects, but scoring starts once it&apos;s ready.</p>
      )}

      {data.assignments.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={<Gavel className="size-5" />} title="Nothing assigned yet">
            Organizers assign projects after the submission deadline. They&apos;ll appear here.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {GROUPS.map((g) => {
            const items = data.assignments.filter((a) => (g.statuses as readonly string[]).includes(a.status));
            if (!items.length) return null;
            return (
              <section key={g.key}>
                <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                  <g.icon className="size-5 text-muted" /> {g.title} <span className="text-sm font-semibold text-muted">{items.length}</span>
                </h2>
                <ul className="grid gap-3 md:grid-cols-2">
                  {items.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/events/${slug}/judging/${a.id}`}
                        className="group flex gap-4 rounded-2xl border border-line bg-surface p-3 shadow-card transition hover:border-line-strong hover:shadow-lift"
                      >
                        <Cover seed={a.project.id} src={a.project.thumbnailUrl} label={a.project.title} rounded="rounded-xl" className="aspect-[4/3] w-28 shrink-0" />
                        <div className="min-w-0 flex-1 py-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="truncate font-bold group-hover:text-primary">{a.project.title}</h3>
                            <Pill tone={a.status === "submitted" ? "success" : a.status === "in_progress" ? "primary" : a.status === "recused" ? "neutral" : "warn"}>
                              {a.status === "assigned" ? "To review" : a.status === "in_progress" ? "Draft saved" : a.status === "submitted" ? "Submitted" : "Recused"}
                            </Pill>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-sm text-muted">{a.project.tagline}</p>
                          <p className="mt-2 text-xs text-muted">
                            {a.project.team}
                            {a.project.track && ` · ${a.project.track}`}
                            {a.submittedAt ? ` · submitted ${formatDate(a.submittedAt)}` : a.lastSavedAt ? ` · saved ${formatDate(a.lastSavedAt)}` : ""}
                            {a.recusalReason && ` · ${a.recusalReason}`}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
