import { CalendarDays, Globe, Trophy, Users } from "lucide-react";
import { getEvent, getMyTeam } from "@/lib/data";
import { getMe } from "@/lib/session";
import { Cover, LogoTile } from "@/components/visuals";
import { EventTabs } from "@/components/EventTabs";
import { currentView, viewsFor } from "@/lib/view";

const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await getEvent(slug);
  return { title: event.name, description: event.tagline || event.description };
}

export default async function EventHubLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [data, me] = await Promise.all([getEvent(slug), getMe()]);
  const team = me.user ? await getMyTeam(slug) : null;
  const { event, stats, myRoles } = data;
  const base = `/events/${slug}`;
  const isStaff = !!me.user?.isAdmin || myRoles.includes("organizer");
  // With more than one view, each role's tab shows only in its own view (the header switches).
  const view = await currentView(me);
  const inView = (v: typeof view) => viewsFor(me).length < 2 || view === v;

  const tabs = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/prizes`, label: "Prizes", count: data.prizes.length || undefined },
    { href: `${base}/rules`, label: "Rules" },
    { href: `${base}/updates`, label: "Updates" },
    ...(event.registrationWindow === "open" ? [{ href: `${base}/team-finder`, label: "Find a team" }] : []),
    { href: `${base}/projects`, label: "Projects", count: stats.projects },
    ...(event.votingWindow !== "off" && !event.votingPublished ? [{ href: `${base}/vote`, label: "Vote" }] : []),
    ...(event.votingPublished ? [{ href: `${base}/peoples-choice`, label: "People's Choice" }] : []),
    ...(event.resultsPublished ? [{ href: `${base}/results`, label: "Results" }] : []),
    ...(me.user && (myRoles.includes("participant") || team?.team) && inView("participant") ? [{ href: `${base}/team`, label: "My team" }] : []),
    ...(myRoles.includes("judge") && inView("judge") ? [{ href: `${base}/judging`, label: "Judging" }] : []),
    ...(isStaff && inView("organizer") ? [{ href: `${base}/manage`, label: "Manage" }] : []),
  ];

  return (
    <div>
      {/* banner */}
      <div className="relative h-44 sm:h-64">
        <Cover seed={event.slug} src={event.bannerUrl} label={event.name} monogram={false} rounded="rounded-none" className="size-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-transparent" />
      </div>

      {/* identity */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col gap-5 pb-2 sm:flex-row sm:items-end">
            <div className="relative z-10 -mt-12 shrink-0 sm:-mt-16">
              <LogoTile seed={event.slug} src={event.logoUrl} name={event.name} className="size-24 border-4 border-surface text-3xl shadow-lift sm:size-32 sm:text-4xl" />
            </div>
            <div className="min-w-0 flex-1 pb-3 sm:pt-4">
              <h1 className="text-3xl font-extrabold leading-tight sm:text-[40px]">{event.name}</h1>
              {event.tagline && <p className="mt-1.5 text-base text-muted sm:text-lg">{event.tagline}</p>}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="size-4 text-muted" /> {event.location}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4 text-muted" /> {fmt(event.submissionsOpenAt)} – {fmt(event.submissionsCloseAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-4 text-muted" /> {stats.participants.toLocaleString()} participant{stats.participants === 1 ? "" : "s"}
                </span>
                {stats.prizeTotal && (
                  <span className="inline-flex items-center gap-1.5">
                    <Trophy className="size-4 text-accent" /> {stats.prizeTotal} in prizes
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="sticky top-16 z-30 border-t border-line bg-surface/90 backdrop-blur-md">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <EventTabs tabs={tabs} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">{children}</div>
    </div>
  );
}
