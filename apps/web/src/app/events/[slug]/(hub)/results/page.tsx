import Link from "next/link";
import { Medal, Scale, Trophy } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PublicResults } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { HubColumns } from "@/components/HubColumns";
import { Card, Chip, EmptyState, Pill } from "@/components/ui";
import { AvatarStack, Cover } from "@/components/visuals";

export const metadata = { title: "Results" };

const MEDAL = [
  { ring: "ring-[#e8b923]", chip: "bg-[#e8b923] text-[#3b2a00]", label: "1st" },
  { ring: "ring-[#a9b4c2]", chip: "bg-[#c7cfd9] text-[#1f2933]", label: "2nd" },
  { ring: "ring-[#c7773a]", chip: "bg-[#d98a4e] text-[#2e1500]", label: "3rd" },
];

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ track?: string }> }) {
  const { slug } = await params;
  const { track: trackParam } = await searchParams;
  const data = await api<PublicResults>(`/api/events/${encodeURIComponent(slug)}/results`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });

  if (!data) {
    return (
      <HubColumns slug={slug}>
        <EmptyState icon={<Trophy className="size-5" />} title="Results aren't out yet">
          The organizers publish the ranking once judging has closed and the scores have been checked.
        </EmptyState>
      </HubColumns>
    );
  }

  // An unknown track id (stale link, typo) falls back to the overall ranking.
  const track = data.tracks.some((t) => t.id === trackParam) ? trackParam : undefined;
  const trackName = data.tracks.find((t) => t.id === track)?.name;
  // Within a track, rank among that track's projects using the same adjusted scores.
  const rows = (track ? data.results.filter((r) => r.project.track?.id === track) : data.results).map((r, i) => ({ ...r, place: i + 1 }));
  const podium = rows.slice(0, 3);
  const trackPrizes = track ? data.prizes.filter((p) => p.trackId === track) : data.prizes.filter((p) => !p.trackId);

  return (
    <HubColumns slug={slug}>
      <div className="flex flex-wrap gap-2">
        <Chip href={`/events/${slug}/results`} active={!track}>
          Overall
        </Chip>
        {data.tracks
          .filter((t) => data.results.some((r) => r.project.track?.id === t.id))
          .map((t) => (
            <Chip key={t.id} href={`/events/${slug}/results?track=${t.id}`} active={t.id === track}>
              {t.name}
            </Chip>
          ))}
      </div>

      {podium.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {podium.map((r, i) => (
            <Link
              key={r.project.id}
              href={`/events/${slug}/projects/${r.project.id}`}
              className={`group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lift ${i === 0 ? "sm:order-2" : i === 1 ? "sm:order-1 sm:mt-6" : "sm:order-3 sm:mt-10"}`}
            >
              <Cover seed={r.project.id} src={r.project.thumbnailUrl} label={r.project.title} rounded="rounded-none" className="aspect-[16/9] w-full" />
              <span className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold shadow ${MEDAL[i]!.chip}`}>
                <Medal className="size-3.5" /> {MEDAL[i]!.label}
              </span>
              <div className="p-4">
                {trackPrizes[i] && (
                  <p className="mb-1 text-xs font-bold uppercase tracking-wider text-accent">
                    {trackPrizes[i]!.name}
                    {trackPrizes[i]!.value && ` · ${trackPrizes[i]!.value}`}
                  </p>
                )}
                <h3 className="truncate text-lg font-bold group-hover:text-primary">{r.project.title}</h3>
                <p className="line-clamp-2 text-sm text-muted">{r.project.tagline}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
                    <AvatarStack names={r.project.members} size={20} /> <span className="truncate">{r.project.team}</span>
                  </span>
                  <span className="font-display text-xl font-extrabold tabular-nums">{r.score.toFixed(2)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Card
        title={trackName ? `${trackName} ranking` : "Full ranking"}
        description={`${rows.length} project${rows.length === 1 ? "" : "s"} · scores out of 5`}
        padded={false}
      >
        <ol className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.project.id}>
              <Link href={`/events/${slug}/projects/${r.project.id}`} className="group flex items-center gap-4 px-5 py-3 transition hover:bg-surface-2 sm:px-6">
                <span className={`w-8 shrink-0 text-center font-display text-lg font-extrabold tabular-nums ${r.place <= 3 ? "text-ink" : "text-muted"}`}>{r.place}</span>
                <Cover
                  seed={r.project.id}
                  src={r.project.thumbnailUrl}
                  label={r.project.title}
                  monogram={false}
                  rounded="rounded-lg"
                  className="hidden aspect-[4/3] w-16 shrink-0 sm:block"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold group-hover:text-primary">{r.project.title}</span>
                    {r.provisional && (
                      <span title="Fewer reviews than planned, so this score is less certain.">
                        <Pill tone="warn">provisional</Pill>
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {r.project.team}
                    {!track && r.project.track && ` · ${r.project.track.name}`}
                  </div>
                </div>
                <div className="hidden w-28 sm:block">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${((r.score - 1) / 4) * 100}%` }} />
                  </div>
                </div>
                <span className="w-12 text-right font-semibold tabular-nums">{r.score.toFixed(2)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <div className="flex items-start gap-3 text-sm">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Scale className="size-5" />
          </div>
          <div>
            <h3 className="font-bold">How this ranking was made</h3>
            <p className="mt-1 text-muted">
              Each project was scored by several judges on a weighted rubric. Some judges score harder than others, so each judge&apos;s leniency was estimated from the
              projects they shared with other judges and taken out of their scores. That way no project is helped or hurt by who happened to review it. Projects marked
              provisional had fewer reviews than planned. Computed {formatDate(data.publishedRun.computedAt)}.
            </p>
          </div>
        </div>
      </Card>
    </HubColumns>
  );
}
