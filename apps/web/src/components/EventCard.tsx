import Link from "next/link";
import { CalendarDays, Globe, Trophy, Users } from "lucide-react";
import type { EventSummary } from "@/lib/types";
import { phaseOf, relativeLeft } from "@/lib/phase";
import { Cover } from "./visuals";
import { Pill } from "./ui";

const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

/** Devpost-style listing card: cover left, details middle, status right. */
export function EventCard({ e }: { e: EventSummary }) {
  const p = phaseOf(e);
  return (
    <Link
      href={`/events/${e.slug}`}
      className="group grid overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift sm:grid-cols-[260px_1fr]"
    >
      <div className="relative">
        <Cover seed={e.slug} src={e.bannerUrl} label={e.name} rounded="rounded-none" className="aspect-[16/9] size-full sm:aspect-auto sm:h-full" />
        {e.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.logoUrl} alt="" className="absolute bottom-3 left-3 size-12 rounded-xl border-2 border-surface bg-surface object-cover shadow-card" />
        )}
      </div>
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone={p.tone}>
              {p.phase === "submissions" && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
              {p.label}
            </Pill>
            {p.countdownTo && <span className="text-xs font-semibold text-muted">{relativeLeft(p.countdownTo)}</span>}
          </div>
          <h3 className="text-xl font-bold leading-snug text-ink transition group-hover:text-primary">{e.name}</h3>
          {(e.tagline || e.description) && <p className="mt-1 line-clamp-2 text-sm text-muted">{e.tagline || e.description}</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-medium text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <Globe className="size-4 text-muted" /> {e.location}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4 text-muted" /> {e.participantCount.toLocaleString()} participant{e.participantCount === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4 text-muted" /> {fmt(e.submissionsOpenAt)} – {fmt(e.submissionsCloseAt)}
            </span>
          </div>
          {e.tracks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {e.tracks.slice(0, 4).map((t) => (
                <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2">
                  {t}
                </span>
              ))}
              {e.tracks.length > 4 && <span className="px-1 py-0.5 text-xs font-semibold text-muted">+{e.tracks.length - 4} more</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-row items-center justify-between gap-3 border-t border-line pt-3 sm:w-36 sm:flex-col sm:items-end sm:justify-start sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          {e.prizeTotal ? (
            <div className="sm:text-right">
              <div className="font-display text-2xl font-extrabold text-ink">{e.prizeTotal}</div>
              <div className="text-xs font-medium text-muted">in prizes</div>
            </div>
          ) : e.prizeCount > 0 ? (
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2">
              <Trophy className="size-4 text-accent" /> {e.prizeCount} prizes
            </div>
          ) : (
            <span />
          )}
          <div className="sm:text-right">
            <div className="font-display text-lg font-bold text-ink">{e.projectCount}</div>
            <div className="text-xs font-medium text-muted">projects</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
