import Link from "next/link";
import { ArrowRight, Scale, Trophy } from "lucide-react";
import { getEvent } from "@/lib/data";
import { HubColumns } from "@/components/HubColumns";
import { Markdown } from "@/components/Markdown";
import { Card } from "@/components/ui";
import { paletteFor } from "@/components/visuals";
import { PrizeCard } from "@/components/PrizeCard";

export default async function EventOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, tracks, prizes, criteria } = await getEvent(slug);
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0);
  const about = event.overview.trim() || event.description.trim();

  return (
    <HubColumns slug={slug}>
      <Card title="About this hackathon">
        {about ? <Markdown>{about}</Markdown> : <p className="text-sm text-muted">The organizers haven&apos;t written an overview yet.</p>}
      </Card>

      {tracks.length > 0 && (
        <Card title="Tracks" description="Pick the track your project fits best.">
          <div className="grid gap-3 sm:grid-cols-2">
            {tracks.map((t) => {
              const [a, b] = paletteFor(t.name);
              return (
                <Link
                  key={t.id}
                  href={`/events/${slug}/projects?track=${t.id}`}
                  className="group flex min-w-0 items-center gap-3 rounded-xl border border-line p-3.5 transition hover:border-line-strong hover:bg-surface-2"
                >
                  <span className="size-10 shrink-0 rounded-xl" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.name}</span>
                    <span className="block truncate text-xs text-muted">{t.description || `${t.projectCount ?? 0} projects`}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {prizes.length > 0 && (
        <Card
          title="Prizes"
          actions={
            <Link href={`/events/${slug}/prizes`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              All prizes <ArrowRight className="size-4" />
            </Link>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {prizes.slice(0, 3).map((p, i) => (
              <PrizeCard key={p.id} prize={p} index={i} trackName={tracks.find((t) => t.id === p.trackId)?.name} compact />
            ))}
          </div>
        </Card>
      )}

      {criteria.length > 0 && (
        <Card title="How projects are judged" description="How judges score projects.">
          <div className="space-y-3">
            {criteria.map((c) => {
              const pct = totalWeight ? Math.round((c.weight / totalWeight) * 100) : 0;
              return (
                <div key={c.key}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <Scale className="size-4 text-muted" /> {c.label}
                    </span>
                    <span className="font-bold tabular-nums">{pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-[#9b6bff]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {prizes.length === 0 && tracks.length === 0 && !about && (
        <Card>
          <div className="flex items-center gap-3 text-sm text-muted">
            <Trophy className="size-5" /> More details are coming soon.
          </div>
        </Card>
      )}
    </HubColumns>
  );
}
