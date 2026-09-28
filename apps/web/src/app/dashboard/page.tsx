import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, Compass, FileEdit, Gavel, Megaphone, PlusCircle, Settings2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import { phaseOf, relativeLeft } from "@/lib/phase";
import { formatDate } from "@/lib/format";
import type { EventSummary } from "@/lib/types";
import { buttonClass, Pill } from "@/components/ui";
import { LogoTile } from "@/components/visuals";

export const metadata = { title: "Dashboard" };

type DashEvent = {
  slug: string; name: string; tagline: string; logoUrl: string | null;
  registrationOpensAt: string | null; submissionsOpenAt: string; submissionsCloseAt: string; judgingOpensAt: string | null; judgingClosesAt: string | null;
  votingOpensAt: string | null; votingClosesAt: string | null; publishedAt?: string | null;
  roles: Array<"participant" | "judge" | "organizer">;
  participant: { team: { id: string; name: string; members: number; role: string } | null; project: { id: string; title: string; status: string } | null } | null;
  judge: { assigned: number; submitted: number; inProgress: number } | null;
  organizer: { participants: number; submitted: number; drafts: number; reviews: number; reviewsExpected: number; judges: number; reported: number } | null;
};

const greeting = () => {
  const h = new Date().getUTCHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default async function DashboardPage() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/dashboard");
  const [{ events }, all] = await Promise.all([api<{ events: DashEvent[] }>("/api/me/dashboard"), api<{ events: EventSummary[] }>("/api/events")]);
  const now = Date.now();

  const deadlines = events
    .flatMap((e) => {
      const d: Array<{ at: string; label: string; href: string; event: string }> = [];
      if (e.roles.includes("participant")) d.push({ at: e.submissionsCloseAt, label: e.participant?.project?.status === "submitted" ? "Submissions close (you're in)" : "Submit your project", href: `/events/${e.slug}/team`, event: e.name });
      if (e.roles.includes("judge") && e.judgingClosesAt) d.push({ at: e.judgingClosesAt, label: `Finish judging (${e.judge!.submitted}/${e.judge!.assigned})`, href: `/events/${e.slug}/judging`, event: e.name });
      if (e.roles.includes("organizer")) {
        d.push({ at: e.submissionsCloseAt, label: "Submissions close", href: `/events/${e.slug}/manage`, event: e.name });
        if (e.judgingClosesAt) d.push({ at: e.judgingClosesAt, label: "Judging closes", href: `/events/${e.slug}/manage/progress`, event: e.name });
      }
      if (e.votingClosesAt) d.push({ at: e.votingClosesAt, label: "Voting closes", href: `/events/${e.slug}/vote`, event: e.name });
      return d;
    })
    .filter((d) => new Date(d.at).getTime() > now)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 5);

  const organizing = events.filter((e) => e.organizer);
  const judging = events.filter((e) => e.judge);
  const building = events.filter((e) => e.participant);
  const mine = new Set(events.map((e) => e.slug));
  const joinable = all.events.filter((e) => !mine.has(e.slug) && ["registration", "submissions"].includes(phaseOf(e).phase)).slice(0, 3);

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">{greeting()},</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">{me.user.name.split(" ")[0]}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/hackathons" className={buttonClass("secondary", "md")}>
            <Compass className="size-4" /> Browse hackathons
          </Link>
          <Link href="/events/new" className={buttonClass("primary", "md")}>
            <PlusCircle className="size-4" /> Host a hackathon
          </Link>
        </div>
      </div>

      {events.length === 0 ? (
        <section className="grid gap-4 md:grid-cols-2">
          {[
            { href: "/hackathons", icon: Compass, title: "Join a hackathon", body: "Find one that's open, register, and build with a team." },
            { href: "/events/new", icon: Megaphone, title: "Host your own", body: "Set dates, tracks and prizes. It stays private until you publish." },
          ].map((c) => (
            <Link key={c.href} href={c.href} className="group rounded-2xl border border-line bg-surface p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift">
              <c.icon className="size-6 text-primary" />
              <h2 className="mt-3 text-lg font-bold group-hover:text-primary">{c.title}</h2>
              <p className="mt-1 text-sm text-muted">{c.body}</p>
            </Link>
          ))}
        </section>
      ) : (
        <>
          {deadlines.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
                <CalendarClock className="size-4" /> Coming up
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {deadlines.map((d) => (
                  <li key={`${d.href}${d.label}`}>
                    <Link href={d.href} className="flex h-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card transition hover:border-line-strong">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{d.label}</p>
                        <p className="truncate text-xs text-muted">
                          {d.event} · {formatDate(d.at)}
                        </p>
                      </div>
                      <Pill tone={new Date(d.at).getTime() - now < 24 * 3_600_000 ? "danger" : "neutral"}>{relativeLeft(d.at)}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {organizing.length > 0 && (
            <Section icon={<Settings2 className="size-4" />} title="Organizing">
              {organizing.map((e) => {
                const o = e.organizer!;
                const pct = o.reviewsExpected ? Math.min(100, Math.round((o.reviews / o.reviewsExpected) * 100)) : 0;
                return (
                  <EventTile key={e.slug} e={e} href={`/events/${e.slug}/manage`} action="Manage">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Stat n={o.participants} label="builders" />
                      <Stat n={o.submitted} label="submitted" />
                      <Stat n={o.judges} label="judges" />
                    </div>
                    {o.reviewsExpected > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-muted">
                          <span>Judging</span>
                          <span className="tabular-nums">{pct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                    {o.reported > 0 && (
                      <Link href={`/events/${e.slug}/manage/comments`} className="mt-3 block text-xs font-semibold text-warn hover:underline">
                        {o.reported} reported comment{o.reported === 1 ? "" : "s"} to review
                      </Link>
                    )}
                  </EventTile>
                );
              })}
            </Section>
          )}

          {judging.length > 0 && (
            <Section icon={<Gavel className="size-4" />} title="Judging">
              {judging.map((e) => {
                const j = e.judge!;
                const left = j.assigned - j.submitted;
                return (
                  <EventTile key={e.slug} e={e} href={`/events/${e.slug}/judging`} action={left > 0 ? "Continue judging" : "Open"}>
                    <p className="text-sm">
                      <b className="tabular-nums">{j.submitted}</b> of <b className="tabular-nums">{j.assigned}</b> reviews submitted
                      {j.inProgress > 0 && <span className="text-muted"> · {j.inProgress} in progress</span>}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${j.assigned ? (j.submitted / j.assigned) * 100 : 0}%` }} />
                    </div>
                  </EventTile>
                );
              })}
            </Section>
          )}

          {building.length > 0 && (
            <Section icon={<Users className="size-4" />} title="Building">
              {building.map((e) => {
                const p = e.participant!;
                return (
                  <EventTile key={e.slug} e={e} href={p.project ? `/events/${e.slug}/projects/${p.project.id}` : `/events/${e.slug}/team`} action={p.project ? "Open project" : p.team ? "Start your project" : "Find a team"}>
                    {p.team ? (
                      <p className="text-sm">
                        Team <b>{p.team.name}</b> · {p.team.members} member{p.team.members === 1 ? "" : "s"}
                      </p>
                    ) : (
                      <p className="text-sm text-muted">No team yet</p>
                    )}
                    {p.project && (
                      <p className="mt-1 flex items-center gap-2 text-sm">
                        <FileEdit className="size-4 text-muted" /> {p.project.title}
                        <Pill tone={p.project.status === "submitted" ? "success" : "warn"}>{p.project.status}</Pill>
                      </p>
                    )}
                  </EventTile>
                );
              })}
            </Section>
          )}
        </>
      )}

      {joinable.length > 0 && (
        <Section icon={<Compass className="size-4" />} title="Open to join">
          {joinable.map((e) => (
            <EventTile key={e.slug} e={{ ...e, roles: [], participant: null, judge: null, organizer: null, votingOpensAt: null, votingClosesAt: null }} href={`/events/${e.slug}`} action="View hackathon">
              {e.tagline && <p className="line-clamp-2 text-sm text-muted">{e.tagline}</p>}
              <p className="mt-2 text-xs text-muted">{relativeLeft(e.submissionsCloseAt)} to submit</p>
            </EventTile>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
        {icon} {title}
      </h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function EventTile({ e, href, action, children }: { e: DashEvent; href: string; action: string; children: React.ReactNode }) {
  const ph = phaseOf(e);
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <LogoTile seed={e.slug} src={e.logoUrl} name={e.name} className="size-11 shrink-0 text-sm" />
        <div className="min-w-0 flex-1">
          <Link href={`/events/${e.slug}`} className="block truncate font-bold hover:text-primary">
            {e.name}
          </Link>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {e.publishedAt === null ? <Pill tone="warn">Draft</Pill> : <Pill tone={ph.tone}>{ph.label}</Pill>}
          </div>
        </div>
      </div>
      <div className="mt-4 flex-1">{children}</div>
      <Link href={href} className="mt-4 inline-flex items-center gap-1 self-start text-sm font-semibold text-primary hover:underline">
        {action} <ArrowRight className="size-4" />
      </Link>
    </article>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg bg-surface-2/70 py-2">
      <div className="font-display text-lg font-extrabold tabular-nums">{n}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
