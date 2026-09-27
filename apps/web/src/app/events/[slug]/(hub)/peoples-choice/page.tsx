import Link from "next/link";
import { Download, Heart, Medal, Scale, Shuffle, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PublicVotingResults } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { HubColumns } from "@/components/HubColumns";
import { Card, EmptyState, Pill } from "@/components/ui";
import { AvatarStack, Cover } from "@/components/visuals";
import { PositionChart, positionVerdict } from "@/components/PositionChart";
import { ReceiptCheck } from "./ReceiptCheck";

export const metadata = { title: "People's Choice" };

const MEDAL = ["bg-[#e8b923] text-[#3b2a00]", "bg-[#c7cfd9] text-[#1f2933]", "bg-[#d98a4e] text-[#2e1500]"];

export default async function PeoplesChoicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<PublicVotingResults>(`/api/events/${encodeURIComponent(slug)}/voting/results`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!data) {
    return (
      <HubColumns slug={slug}>
        <EmptyState icon={<Heart className="size-5" />} title="People's Choice results aren't out yet">
          They&apos;re published after voting closes and the organizers have reviewed the ballots.
        </EmptyState>
      </HubColumns>
    );
  }

  const podium = data.ranking.filter((r) => r.votes > 0).slice(0, 3);
  const withVotes = data.ranking.filter((r) => r.votes > 0);
  const noVotes = data.ranking.filter((r) => r.votes === 0);
  const top = Math.max(1, data.ranking[0]?.votes ?? 1);
  const verdict = positionVerdict(data.positionCheck);

  return (
    <HubColumns slug={slug}>
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Users, value: data.stats.voters, label: "voters" },
          { icon: Heart, value: data.stats.votes, label: `votes (up to ${data.votesPerVoter} each)` },
          { icon: Scale, value: data.stats.quarantinedBallots, label: "ballots set aside" },
        ].map((x) => (
          <div key={x.label} className="rounded-2xl border border-line bg-surface p-4 text-center shadow-card">
            <x.icon className="mx-auto size-5 text-muted" />
            <div className="mt-1 font-display text-2xl font-extrabold tabular-nums">{x.value}</div>
            <div className="text-xs text-muted">{x.label}</div>
          </div>
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
              <Cover seed={r.project.id} src={r.project.thumbnailUrl} label={r.project.title} rounded="rounded-none" className="aspect-[16/8] w-full" />
              <span className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold shadow ${MEDAL[Math.min(r.rank, 3) - 1]}`}>
                <Medal className="size-3.5" /> {r.rank === 1 ? "1st" : r.rank === 2 ? "2nd" : "3rd"}
              </span>
              <div className="p-4">
                <h3 className="truncate text-lg font-bold group-hover:text-primary">{r.project.title}</h3>
                <p className="line-clamp-1 text-sm text-muted">{r.project.tagline}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
                    <AvatarStack names={r.project.members} size={20} /> <span className="truncate">{r.project.team}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-display text-xl font-extrabold tabular-nums">
                    <Heart className="size-4 fill-accent text-accent" /> {r.votes}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Card title="Every project" description={`Community vote, closed ${formatDate(data.closedAt)}. Ties share a rank.`} padded={false}>
        <ol className="divide-y divide-line">
          {withVotes.map((r) => (
            <li key={r.project.id}>
              <Link href={`/events/${slug}/projects/${r.project.id}`} className="group flex items-center gap-4 px-5 py-3 transition hover:bg-surface-2 sm:px-6">
                <span className="w-8 shrink-0 text-center font-display text-lg font-extrabold tabular-nums text-muted">{r.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold group-hover:text-primary">{r.project.title}</div>
                  <div className="truncate text-xs text-muted">
                    {r.project.team}
                    {r.project.track && ` · ${r.project.track.name}`}
                  </div>
                </div>
                <div className="hidden w-40 sm:block">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(r.votes / top) * 100}%` }} />
                  </div>
                </div>
                <span className="w-16 text-right font-semibold tabular-nums">
                  {r.votes} <span className="text-xs font-normal text-muted">vote{r.votes === 1 ? "" : "s"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {noVotes.length > 0 && (
          <p className="border-t border-line px-5 py-3 text-xs text-muted sm:px-6">
            <b className="text-ink-2">No votes ({noVotes.length}):</b> {noVotes.map((r) => r.project.title).join(", ")}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Check your ballot" description="Enter the receipt you got when you voted to see whether your ballot was counted, exactly as you cast it.">
          <ReceiptCheck slug={slug} />
        </Card>
        <Card title="Recount it yourself" description="Every ballot is published, anonymous, under the hash of its receipt. Nothing else identifies a voter.">
          <a href={data.ballotFile.url} download className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm font-semibold hover:border-line-strong">
            <Download className="size-4" /> ballots.json · {data.ballotFile.ballots} ballots
          </a>
          <p className="mt-3 text-xs text-muted">
            SHA-256 fixed when these results were published ({formatDate(data.publishedAt)}):
          </p>
          <p className="mt-1 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">{data.ballotFile.sha256}</p>
          <p className="mt-2 text-xs">
            {data.ballotFile.matches ? (
              <Pill tone="success">today&apos;s file matches it</Pill>
            ) : (
              <Pill tone="danger">today&apos;s file does not match: ask the organizers</Pill>
            )}
          </p>
          <p className="mt-3 text-xs text-muted">
            To recount: for every ballot with <code className="font-mono">&quot;status&quot;: &quot;counted&quot;</code>, add one vote to each project in its{" "}
            <code className="font-mono">picks</code>. Ballots set aside by the organizers are listed too, marked <code className="font-mono">quarantined</code>.
          </p>
        </Card>
      </div>

      <Card title="Did list position matter?" description="Every voter saw the projects in their own random order. If that worked, picks spread across positions evenly.">
        <PositionChart check={data.positionCheck} />
        <p className={`mt-4 flex items-start gap-2 text-sm ${verdict.tone === "warn" ? "text-warn" : verdict.tone === "success" ? "text-success" : "text-muted"}`}>
          <Shuffle className="mt-0.5 size-4 shrink-0" /> {verdict.text}
        </p>
      </Card>
    </HubColumns>
  );
}
