import { redirect } from "next/navigation";
import { Check, Gavel, Lock, UsersRound } from "lucide-react";
import { getEvent, getMyTeam } from "@/lib/data";
import { getMe } from "@/lib/session";
import { Card, EmptyState } from "@/components/ui";
import { RegisterButton } from "@/components/RegisterButton";
import { CreateTeam, TeamPanel } from "./TeamPanel";

export const metadata = { title: "My team" };

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getMe();
  if (!me.user) redirect(`/login?next=/events/${slug}/team`);
  const [detail, mine] = await Promise.all([getEvent(slug), getMyTeam(slug)]);
  const open = detail.event.registrationWindow === "open";
  const registered = detail.myRoles.includes("participant");
  const team = mine?.team ?? null;
  const project = team?.projects[0];

  const steps = [
    { label: "Register", done: registered },
    { label: "Form a team", done: !!team },
    { label: "Start a draft", done: !!project },
    { label: "Submit", done: project?.status === "submitted" },
  ];
  const current = steps.findIndex((s) => !s.done);

  if (detail.myRoles.includes("judge")) {
    return (
      <EmptyState icon={<Gavel className="size-5" />} title="You're a judge of this event">
        Judges can&apos;t join teams in an event they judge.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {/* progress */}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold ${
              s.done ? "border-success/25 bg-success-soft text-success" : i === current ? "border-primary/30 bg-primary-soft text-primary" : "border-line bg-surface text-muted"
            }`}
          >
            <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-success text-white" : i === current ? "bg-primary text-primary-ink" : "bg-surface-2"}`}>
              {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>

      {mine?.team ? (
        <TeamPanel slug={slug} data={mine} meId={me.user.id} canChange={open} submissionsOpen={detail.event.submissionWindow === "open"} />
      ) : !open ? (
        <EmptyState icon={<Lock className="size-5" />} title="Team formation is closed">
          Registration for this event is not open right now.
        </EmptyState>
      ) : !registered ? (
        <Card title="Join this hackathon" description="Register first, then create a team or join one with an invite link.">
          <div className="max-w-xs">
            <RegisterButton slug={slug} />
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Start a team" description="You'll be the captain. Invite teammates with a link or by email.">
            <CreateTeam slug={slug} />
          </Card>
          <Card title="Join a team">
            <div className="flex items-start gap-3 text-sm text-muted">
              <UsersRound className="mt-0.5 size-5 shrink-0" />
              <p>Ask a teammate for their invite link, or check your email for an invitation. Opening the link adds you to their team.</p>
            </div>
            <p className="mt-4 text-xs text-muted">Teams can have up to {detail.event.maxTeamSize} members. Solo entries are welcome.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
