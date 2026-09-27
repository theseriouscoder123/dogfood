import { Trophy } from "lucide-react";
import { getEvent } from "@/lib/data";
import { HubColumns } from "@/components/HubColumns";
import { PrizeCard } from "@/components/PrizeCard";
import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Prizes" };

export default async function PrizesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { prizes, tracks, stats } = await getEvent(slug);
  const overall = prizes.filter((p) => !p.trackId);
  const byTrack = tracks.map((t) => ({ track: t, prizes: prizes.filter((p) => p.trackId === t.id) })).filter((g) => g.prizes.length);

  return (
    <HubColumns slug={slug}>
      {prizes.length === 0 ? (
        <EmptyState icon={<Trophy className="size-5" />} title="Prizes will be announced soon" />
      ) : (
        <>
          {stats.prizeTotal && (
            <div className="relative overflow-hidden rounded-2xl bg-hero p-6 text-hero-ink">
              <div className="hero-grid absolute inset-0" />
              <div className="absolute -right-16 -top-16 size-56 rounded-full bg-[#ff6b35] opacity-30 blur-3xl" />
              <p className="relative text-sm font-semibold text-white/70">Total prize pool</p>
              <p className="relative font-display text-5xl font-extrabold">{stats.prizeTotal}</p>
              <p className="relative mt-1 text-sm text-white/60">
                across {prizes.length} prize{prizes.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
          {overall.length > 0 && (
            <Card title="Overall prizes">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {overall.map((p, i) => (
                  <PrizeCard key={p.id} prize={p} index={i} />
                ))}
              </div>
            </Card>
          )}
          {byTrack.map(({ track, prizes: tp }) => (
            <Card key={track.id} title={`${track.name} track`}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {tp.map((p, i) => (
                  <PrizeCard key={p.id} prize={p} index={i} />
                ))}
              </div>
            </Card>
          ))}
        </>
      )}
    </HubColumns>
  );
}
