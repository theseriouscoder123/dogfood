import Link from "next/link";
import { Check, Layers, Trophy, Users, UsersRound } from "lucide-react";
import type { EventDetail, Me, MyTeam } from "@/lib/types";
import { phaseOf } from "@/lib/phase";
import { formatDate } from "@/lib/format";
import { Countdown } from "./Countdown";
import { RegisterButton } from "./RegisterButton";
import { buttonClass, Pill } from "./ui";

/** The "what do I do now" card: status, countdown, the right call to action, and the timeline. */
export function EventSidebar({ data, me, team }: { data: EventDetail; me: Me; team: MyTeam | null }) {
  const { event, stats, myRoles } = data;
  const p = phaseOf(event);
  const slug = event.slug;
  const isStaff = !!me.user?.isAdmin || myRoles.includes("organizer");
  const isJudge = myRoles.includes("judge");
  const hasTeam = !!team?.team;
  const regOpen = event.registrationWindow === "open";
  const project = team?.team?.projects[0];

  let cta: React.ReactNode;
  if (isJudge) {
    cta = <p className="rounded-xl bg-warn-soft px-3 py-2.5 text-center text-sm font-semibold text-warn">You&apos;re judging this event</p>;
  } else if (!me.user && regOpen) {
    cta = (
      <Link href={`/register?next=/events/${slug}/team`} className={buttonClass("accent", "lg", "w-full")}>
        Register now
      </Link>
    );
  } else if (me.user && !myRoles.includes("participant") && regOpen) {
    cta = <RegisterButton slug={slug} />;
  } else if (hasTeam && project) {
    cta = (
      <Link href={event.submissionWindow === "open" ? `/events/${slug}/projects/${project.id}/edit` : `/events/${slug}/projects/${project.id}`} className={buttonClass("primary", "lg", "w-full")}>
        {event.submissionWindow === "open" ? (project.status === "submitted" ? "Update submission" : "Finish your submission") : "View your project"}
      </Link>
    );
  } else if (myRoles.includes("participant") && regOpen) {
    cta = (
      <Link href={`/events/${slug}/team`} className={buttonClass("primary", "lg", "w-full")}>
        {hasTeam ? "Start your project" : "Find or create a team"}
      </Link>
    );
  } else {
    cta = (
      <Link href={`/events/${slug}/projects`} className={buttonClass("secondary", "lg", "w-full")}>
        Browse projects
      </Link>
    );
  }

  const timeline: Array<[string, string | null]> = [
    ["Registration opens", event.registrationOpensAt],
    ["Submissions open", event.submissionsOpenAt],
    ["Submission deadline", event.submissionsCloseAt],
    ["Judging opens", event.judgingOpensAt],
    ["Winners announced", event.judgingClosesAt],
  ];
  const now = Date.now();

  return (
    <aside className="space-y-4 lg:sticky lg:top-[132px]">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <Pill tone={p.tone}>
            {p.phase === "submissions" && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
            {p.label}
          </Pill>
          {stats.prizeTotal && (
            <span className="inline-flex items-center gap-1 text-sm font-bold text-ink">
              <Trophy className="size-4 text-accent" /> {stats.prizeTotal}
            </span>
          )}
        </div>
        {p.countdownTo && (
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold text-muted">{p.countdownLabel}</p>
            <Countdown to={p.countdownTo} />
          </div>
        )}
        {cta}
        {isStaff && (
          <Link href={`/events/${slug}/manage`} className={buttonClass("secondary", "md", "mt-2 w-full")}>
            Manage event
          </Link>
        )}
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
          {[
            [<Users key="u" className="size-4" />, stats.participants, "builders"],
            [<UsersRound key="t" className="size-4" />, stats.teams, "teams"],
            [<Layers key="p" className="size-4" />, stats.projects, "projects"],
          ].map(([icon, n, label]) => (
            <div key={String(label)}>
              <div className="flex items-center justify-center gap-1 text-muted">{icon}</div>
              <div className="font-display text-lg font-bold">{String(n)}</div>
              <div className="text-[11px] font-medium text-muted">{String(label)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="mb-4 text-sm font-bold">Schedule</h3>
        <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-line">
          {timeline
            .filter(([, iso]) => iso)
            .map(([label, iso]) => {
              const done = new Date(iso!).getTime() <= now;
              return (
                <li key={label} className="relative flex gap-3">
                  <span className={`relative z-10 mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full border-2 ${done ? "border-primary bg-primary text-primary-ink" : "border-line-strong bg-surface"}`}>
                    {done && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <div>
                    <div className={`text-sm font-semibold ${done ? "text-ink" : "text-ink-2"}`}>{label}</div>
                    <div className="text-xs text-muted">{formatDate(iso)}</div>
                  </div>
                </li>
              );
            })}
        </ol>
      </div>
    </aside>
  );
}
