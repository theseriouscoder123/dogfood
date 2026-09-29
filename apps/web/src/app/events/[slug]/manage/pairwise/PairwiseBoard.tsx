"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, Download, GitCompareArrows, Scale, Users } from "lucide-react";
import { send } from "@/lib/client";
import type { PairwiseReport } from "@/lib/types";
import { buttonClass, Card, EmptyState, Pill, Stat } from "@/components/ui";
import { useToast } from "@/components/feedback";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export function PairwiseBoard({ slug, data }: { slug: string; data: PairwiseReport }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const r = await send("PUT", `/api/events/${slug}/pairwise/settings`, { enabled: !data.enabled });
    setPending(false);
    if (!r.ok) return toast.error(r.message);
    toast.success(data.enabled ? "Head-to-head judging is off" : "Judges can now compare projects head to head");
    router.refresh();
  }

  const bias = data.positionBias;
  const disagreements = data.projects.filter((p) => p.disagreement).length;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
            <ArrowLeftRight className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{data.enabled ? "Judges can compare projects" : "Head-to-head judging is off"}</p>
            <p className="text-sm text-muted">{data.enabled ? "Each judge sees pairs from their own assignments, next to their rubric reviews." : "Turn it on to add a second, scale-free opinion to the rubric."}</p>
          </div>
          <button type="button" onClick={toggle} disabled={pending} className={buttonClass(data.enabled ? "secondary" : "primary", "md")}>
            {data.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </Card>

      {data.comparisons === 0 ? (
        <EmptyState icon={<GitCompareArrows className="size-5" />} title="No comparisons yet" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><Stat icon={<GitCompareArrows className="size-5" />} label="comparisons" value={data.comparisons} /></Card>
            <Card><Stat icon={<Scale className="size-5" />} label="agreement with rubric (Spearman)" value={data.agreement === null ? "–" : data.agreement.toFixed(2)} /></Card>
            <Card><Stat icon={<AlertTriangle className="size-5" />} label={`projects placed ${data.disagreementThreshold}+ apart`} value={disagreements} /></Card>
            <Card>
              <Stat icon={<ArrowLeftRight className="size-5" />} label={bias.flagged ? "left side wins too often" : "left side wins (no bias)"} value={pct(bias.leftShare)} />
            </Card>
          </div>

          <Card title="Ranking" padded={false} actions={<a href={`/api/events/${slug}/export/comparisons.csv`} download className={buttonClass("secondary", "sm")}><Download className="size-4" /> comparisons.csv</a>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-xs font-semibold uppercase tracking-wider text-muted">
                    <th className="px-5 py-2.5">#</th>
                    <th className="py-2.5">Project</th>
                    <th className="py-2.5 text-right">Rating</th>
                    <th className="py-2.5 text-right">90% rank range</th>
                    <th className="py-2.5 text-right">W–L–T</th>
                    <th className="px-5 py-2.5 text-right">Rubric rank</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((p) => (
                    <tr key={p.projectId} className={`border-b border-line last:border-0 ${p.disagreement ? "bg-warn-soft/40" : ""}`}>
                      <td className="px-5 py-3 font-display font-bold tabular-nums">{p.rank}</td>
                      <td className="py-3">
                        <Link href={`/events/${slug}/projects/${p.projectId}`} className="font-semibold hover:text-primary">
                          {p.title}
                        </Link>
                        <span className="block text-xs text-muted">
                          {p.team}
                          {p.track && ` · ${p.track}`}
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {p.rating} <span className="text-xs text-muted">±{Math.round((p.se * 400) / Math.LN10)}</span>
                      </td>
                      <td className="py-3 text-right tabular-nums text-muted">{p.rankLow === p.rankHigh ? p.rankLow : `${p.rankLow}–${p.rankHigh}`}</td>
                      <td className="py-3 text-right tabular-nums">
                        {p.wins}–{p.losses}–{p.ties}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {p.rubricRank ?? "–"}
                        {p.disagreement && (
                          <Pill tone="warn" className="ml-2">
                            differs
                          </Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.uncompared > 0 && <p className="border-t border-line px-5 py-3 text-xs text-muted">{data.uncompared} project{data.uncompared === 1 ? " hasn't" : "s haven't"} been compared yet.</p>}
          </Card>

          <Card title="Judges" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-xs font-semibold uppercase tracking-wider text-muted">
                    <th className="px-5 py-2.5">Judge</th>
                    <th className="py-2.5 text-right">Comparisons</th>
                    <th className="py-2.5 text-right">Too close</th>
                    <th className="px-5 py-2.5 text-right">Sides with the panel</th>
                  </tr>
                </thead>
                <tbody>
                  {data.judges.map((j) => {
                    const odd = j.agreement !== null && j.informative >= 5 && j.agreement < 0.5;
                    return (
                      <tr key={j.judgeId} className="border-b border-line last:border-0">
                        <td className="px-5 py-3 font-semibold">
                          <Users className="mr-2 inline size-4 text-muted" />
                          {j.name}
                        </td>
                        <td className="py-3 text-right tabular-nums">{j.comparisons}</td>
                        <td className="py-3 text-right tabular-nums text-muted">{j.ties}</td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {pct(j.agreement)}
                          {odd && (
                            <Pill tone="warn" className="ml-2">
                              against the panel
                            </Pill>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">Each judge is compared with a model fitted without them, on pairs where the rest of the panel has a view.</p>
          </Card>
        </>
      )}
    </>
  );
}
