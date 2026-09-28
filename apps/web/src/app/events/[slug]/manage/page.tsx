import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Layers, Trophy, Users, UsersRound } from "lucide-react";
import { getEvent } from "@/lib/data";
import { phaseOf } from "@/lib/phase";
import { Countdown } from "@/components/Countdown";
import { Card, Pill } from "@/components/ui";
import { DuplicateButton } from "./DuplicateButton";

export default async function ManageDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getEvent(slug);
  const { event, stats, tracks, prizes, questions } = data;
  const p = phaseOf(event);
  const base = `/events/${slug}/manage`;

  const setup: Array<[string, boolean, string]> = [
    ["Add a banner and logo", !!event.bannerUrl && !!event.logoUrl, "/details"],
    ["Write the overview", !!event.overview.trim(), "/details"],
    ["Publish the rules", !!event.rules.trim(), "/details"],
    ["Create tracks", tracks.length > 0, "/tracks"],
    ["Announce prizes", prizes.length > 0, "/prizes"],
    ["Customize the submission form", questions.length > 0, "/questions"],
  ];
  const done = setup.filter(([, ok]) => ok).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={p.tone}>{p.label}</Pill>
          <DuplicateButton slug={slug} name={event.name} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: Users, label: "Participants", value: stats.participants },
          { icon: UsersRound, label: "Teams", value: stats.teams },
          { icon: Layers, label: "Submitted projects", value: stats.projects },
          { icon: Trophy, label: "Prize pool", value: stats.prizeTotal ?? `${prizes.length} prizes` },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <Icon className="size-5 text-muted" />
            <div className="mt-3 font-display text-3xl font-extrabold">{value}</div>
            <div className="text-sm text-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Setup checklist" description={`${done} of ${setup.length} done`}>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-[#9b6bff]" style={{ width: `${(done / setup.length) * 100}%` }} />
          </div>
          <ul className="divide-y divide-line">
            {setup.map(([label, ok, path]) => (
              <li key={label}>
                <Link href={base + path} className="group flex items-center gap-3 py-3">
                  {ok ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-line-strong" />}
                  <span className={`flex-1 text-sm font-semibold ${ok ? "text-muted line-through decoration-line-strong" : ""}`}>{label}</span>
                  <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        {p.countdownTo && (
          <Card title={p.countdownLabel}>
            <Countdown to={p.countdownTo} />
            <Link href={`${base}/schedule`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              Edit schedule <ArrowRight className="size-4" />
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
