import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, CalendarDays, Gavel, Globe, MapPin, Medal, Pencil, Settings2, Trophy } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { PublicProfile } from "@/lib/types";
import { ordinal } from "@/lib/records";
import { buttonClass, GithubIcon, Pill } from "@/components/ui";
import { Avatar, Cover, LogoTile } from "@/components/visuals";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const p = await api<PublicProfile>(`/api/users/${encodeURIComponent(ref)}`).catch(() => null);
  return { title: p ? p.user.name : "Profile" };
}

const ROLE = { participant: "Builder", judge: "Judge", organizer: "Organizer" } as const;
const month = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

export default async function ProfilePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const [p, me] = await Promise.all([
    api<PublicProfile>(`/api/users/${encodeURIComponent(ref)}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    getMe(),
  ]);
  const u = p.user;
  const own = me.user?.id === u.id;
  const links = [
    u.githubUrl && { href: u.githubUrl, label: u.githubUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "") || "GitHub", icon: <GithubIcon className="size-4" /> },
    u.linkedinUrl && { href: u.linkedinUrl, label: "LinkedIn", icon: <span className="grid size-4 place-items-center rounded-[3px] bg-current text-[9px] font-black leading-none text-bg">in</span> },
    u.website && { href: u.website, label: u.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), icon: <Globe className="size-4" /> },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: React.ReactNode }>;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <Avatar name={u.name} src={u.avatarUrl} size={120} className="ring-4" />
          <div>
            <h1 className="text-2xl font-extrabold">{u.name}</h1>
            <p className="text-muted">@{u.handle}</p>
            {u.headline && <p className="mt-2 text-[15px] text-ink-2">{u.headline}</p>}
          </div>
          {own && (
            <Link href="/account/settings" className={buttonClass("secondary", "md", "w-full")}>
              <Pencil className="size-4" /> Edit profile
            </Link>
          )}
          <ul className="space-y-2 text-sm text-ink-2">
            {u.location && (
              <li className="flex items-center gap-2">
                <MapPin className="size-4 text-muted" /> {u.location}
              </li>
            )}
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 hover:text-primary">
                  <span className="text-muted">{l.icon}</span> <span className="truncate">{l.label}</span>
                </a>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted" /> Joined {month(u.joinedAt)}
            </li>
          </ul>
          {u.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {u.skills.map((s) => (
                <Pill key={s}>{s}</Pill>
              ))}
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: Trophy, n: p.stats.hackathons, label: "hackathons" },
              { icon: Settings2, n: p.stats.projects, label: "projects" },
              { icon: Medal, n: p.stats.podiums, label: "podium finishes" },
              { icon: Gavel, n: p.stats.judged, label: "judged" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                <s.icon className="size-5 text-muted" />
                <div className="mt-2 font-display text-2xl font-extrabold tabular-nums">{s.n}</div>
                <div className="text-xs text-muted">{s.label}</div>
              </div>
            ))}
          </div>

          {u.bio && (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">About</h2>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{u.bio}</p>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Hackathons</h2>
            {p.history.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-muted">{own ? "Join a hackathon and it shows up here." : "No hackathons yet."}</p>
            ) : (
              <ul className="space-y-3">
                {p.history.map((h) => (
                  <li key={h.event.slug} className="flex gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
                    {h.project ? (
                      <Link href={`/events/${h.event.slug}/projects/${h.project.id}`} className="hidden shrink-0 sm:block">
                        <Cover seed={h.project.id} src={h.project.thumbnailUrl} label={h.project.title} className="aspect-[16/10] w-40" />
                      </Link>
                    ) : (
                      <LogoTile seed={h.event.slug} src={h.event.logoUrl} name={h.event.name} className="size-14 shrink-0 text-base" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/events/${h.event.slug}`} className="font-bold hover:text-primary">
                          {h.event.name}
                        </Link>
                        {h.roles.map((r) => (
                          <Pill key={r} tone={r === "judge" ? "primary" : r === "organizer" ? "dark" : "neutral"}>
                            {ROLE[r]}
                          </Pill>
                        ))}
                        {h.placement && h.placement.rank <= 3 && (
                          <Pill tone="accent">
                            <Medal className="size-3.5" /> {ordinal(h.placement.rank)} place
                          </Pill>
                        )}
                      </div>
                      {h.project && (
                        <Link href={`/events/${h.event.slug}/projects/${h.project.id}`} className="mt-1 block font-semibold hover:text-primary">
                          {h.project.title}
                        </Link>
                      )}
                      {h.project?.tagline && <p className="line-clamp-2 text-sm text-muted">{h.project.tagline}</p>}
                      <p className="mt-1 text-xs text-muted">
                        {h.team && <>with {h.team} · </>}
                        {month(h.event.endedAt)}
                        {h.placement && h.placement.rank > 3 && <> · ranked {ordinal(h.placement.rank)} of {h.placement.of}</>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {p.certificates.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Certificates</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {p.certificates.map((c) => (
                  <li key={c.id}>
                    <Link href={`/verify/${c.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card transition hover:border-line-strong">
                      {c.type === "judge_participation" ? <Gavel className="size-5 text-primary" /> : <Award className="size-5 text-accent" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{c.event.name}</span>
                        <span className="text-xs text-muted">{c.type === "judge_participation" ? "Judge" : "Participant"} · signed</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
