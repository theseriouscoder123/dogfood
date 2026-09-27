"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Eye, EyeOff, FileDown, FlaskConical, History, Lock, Minus, Save, Send, SlidersHorizontal, UserX, X } from "lucide-react";
import { send } from "@/lib/client";
import type { JudgeStatRow, NormalizationState, ResultRow, ResultsView, RunOptions } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, buttonClass, Card, ErrorText, inputClass, Pill, SuccessText } from "@/components/ui";
import { Avatar } from "@/components/visuals";

const PROJECT_FLAG: Record<string, { label: string; tone: "warn" | "danger" | "neutral"; title: string }> = {
  provisional: {
    label: "provisional",
    tone: "warn",
    title: "Fewer reviews than the minimum: ranked, but less certain.",
  },
  duplicate: {
    label: "duplicate",
    tone: "danger",
    title: "A duplicate submission: its reviews are kept but not counted.",
  },
  no_reviews: {
    label: "no reviews",
    tone: "neutral",
    title: "Nobody has submitted a review for this project.",
  },
  disconnected: {
    label: "separate judge group",
    tone: "warn",
    title: "Its judges never overlap with the main group, so its score can't be fully compared.",
  },
};
const JUDGE_FLAG: Record<
  string,
  {
    label: string;
    tone: "warn" | "danger" | "neutral" | "primary";
    title: string;
  }
> = {
  generous: {
    label: "generous",
    tone: "primary",
    title: "Scores at least 0.25 above what the model expects.",
  },
  harsh: {
    label: "harsh",
    tone: "primary",
    title: "Scores at least 0.25 below what the model expects.",
  },
  low_sample: {
    label: "few reviews",
    tone: "neutral",
    title: "Fewer than 3 reviews: their offset is shrunk toward zero.",
  },
  low_discrimination: {
    label: "same score for everything",
    tone: "warn",
    title: "Their scores barely vary, so they add little ranking signal.",
  },
  excluded: {
    label: "excluded",
    tone: "danger",
    title: "Left out of this computation.",
  },
};

const fmt = (x: number | null, d = 2) => (x === null ? "–" : x.toFixed(d));

export function ResultsWorkbench({ slug, state, initial, exclude }: { slug: string; state: NormalizationState; initial: ResultsView; exclude?: string }) {
  const router = useRouter();
  const base = `/api/events/${slug}/normalization`;
  const [view, setView] = useState<ResultsView>(initial);
  const [options, setOptions] = useState<RunOptions>(initial.options);
  const [tab, setTab] = useState<"projects" | "judges">("projects");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Arriving from an integrity flag ("Exclude judge…") opens the exclusion dialog straight away.
  const [excluding, setExcluding] = useState<{ judgeId: string; reason: string } | null>(() =>
    exclude && state.judges.some((j) => j.id === exclude) && !initial.options.excludedJudges.some((e) => e.judgeId === exclude) ? { judgeId: exclude, reason: "" } : null,
  );

  const isRun = !!view.run;
  const canPublish = state.judgingWindow === "closed";
  const published = state.runs.find((r) => r.published);

  async function preview(next: RunOptions) {
    setBusy(true);
    const r = await send<ResultsView>("POST", `${base}/preview`, next);
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    setOptions(next);
    setView(r.data);
    setNotice(null);
  }

  async function openRun(id: string) {
    setBusy(true);
    const r = await send<ResultsView>("GET", `${base}/runs/${id}`);
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    setView(r.data);
    setOptions(r.data.options);
    setNotice(null);
  }

  async function saveRun() {
    setBusy(true);
    const r = await send<{ run: { id: string } }>("POST", `${base}/runs`, options);
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    setNotice({
      ok: true,
      text: "Saved. This run is now a permanent snapshot: it can be published, but never edited.",
    });
    await openRun(r.data.run.id);
    router.refresh();
  }

  async function publish(id: string) {
    setBusy(true);
    const r = await send("POST", `${base}/runs/${id}/publish`, {});
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    setNotice({
      ok: true,
      text: "Published. The results tab is now live on the event page.",
    });
    await openRun(id);
    router.refresh();
  }

  async function unpublish() {
    setBusy(true);
    const r = await send("POST", `${base}/unpublish`, {});
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    setNotice({ ok: true, text: "Results are hidden again." });
    if (view.run) await openRun(view.run.id);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* status */}
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-4 ${published ? "border-success/30 bg-success-soft" : "border-line bg-surface"}`}>
        {published ? <Eye className="size-5 text-success" /> : <EyeOff className="size-5 text-muted" />}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-bold">{published ? "Results are public" : "Results are hidden"}</p>
          <p className="text-muted">
            {published
              ? `Showing the run computed ${formatDate(published.createdAt)}${published.stale ? ". Reviews have changed since then, so compute and publish a new run." : "."}`
              : canPublish
                ? "Compute a run, check it, then publish it."
                : "Judging is still open. You can preview and save runs now; publishing unlocks once judging closes."}
          </p>
        </div>
        {published && (
          <Button variant="secondary" size="sm" onClick={unpublish} disabled={busy}>
            <EyeOff className="size-4" /> Unpublish
          </Button>
        )}
      </div>

      <div className="space-y-6">
        {/* what you're looking at */}
        <div className="flex flex-wrap items-center gap-3">
          {isRun ? (
            <>
              <Pill tone={view.run!.published ? "success" : "neutral"}>
                <History className="size-3" /> Saved run · {formatDate(view.run!.createdAt)}
              </Pill>
              {view.run!.published && <Pill tone="success">published</Pill>}
              {view.run!.stale && (
                <Pill tone="warn">
                  <AlertTriangle className="size-3" /> data changed since
                </Pill>
              )}
              <span className="font-mono text-xs text-muted" title="Fingerprint of every score, weight and option that went in">
                {view.run!.inputHash.slice(0, 12)}
              </span>
            </>
          ) : (
            <Pill tone="primary">
              <FlaskConical className="size-3" /> Live preview · not saved
            </Pill>
          )}
          <div className="ml-auto flex gap-2">
            <a href={`${base}/report.md`} download className={buttonClass("ghost", "sm")} title="Raw vs adjusted, judge leniency, a simulation on this event's graph, and the integrity checks">
              <FileDown className="size-4" /> Proof report
            </a>
            {isRun ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => preview(options)} disabled={busy}>
                  <FlaskConical className="size-4" /> Back to live preview
                </Button>
                {!view.run!.published && (
                  <Button
                    size="sm"
                    onClick={() => publish(view.run!.id)}
                    disabled={busy || !canPublish || view.run!.stale}
                    title={!canPublish ? "Publishing unlocks when judging closes" : view.run!.stale ? "The data changed after this run" : undefined}
                  >
                    {canPublish ? <Send className="size-4" /> : <Lock className="size-4" />} Publish this run
                  </Button>
                )}
              </>
            ) : (
              <Button size="sm" onClick={saveRun} disabled={busy || view.summary.reviewsUsed === 0}>
                <Save className="size-4" /> Save as a run
              </Button>
            )}
          </div>
        </div>

        {notice && (notice.ok ? <SuccessText>{notice.text}</SuccessText> : <ErrorText>{notice.text}</ErrorText>)}

        <SummaryTiles view={view} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card title="Options">
            <div className="grid gap-5 text-sm md:grid-cols-3">
              <label className="block">
                <span className="font-semibold">Reviews for a full result</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={options.minReviews}
                  disabled={isRun}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      minReviews: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  onBlur={() => !isRun && preview(options)}
                  className={inputClass}
                />
                <span className="mt-1 block text-xs text-muted">Projects with fewer are still ranked, but marked provisional.</span>
              </label>

              <div>
                <p className="font-semibold">Excluded judges</p>
                {options.excludedJudges.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">None. Exclude a judge from the Judges tab; you&apos;ll need to give a reason, which is kept with the run.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {options.excludedJudges.map((e) => (
                      <li key={e.judgeId} className="rounded-xl border border-line bg-surface-2 p-2.5">
                        <div className="flex items-center gap-2">
                          <UserX className="size-4 text-danger" />
                          <span className="flex-1 truncate font-semibold">{state.judges.find((j) => j.id === e.judgeId)?.name ?? "Judge"}</span>
                          {!isRun && (
                            <button
                              aria-label="Include again"
                              onClick={() =>
                                preview({
                                  ...options,
                                  excludedJudges: options.excludedJudges.filter((x) => x.judgeId !== e.judgeId),
                                })
                              }
                              className="text-muted hover:text-ink"
                            >
                              <X className="size-4" />
                            </button>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted">{e.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
                  <SlidersHorizontal className="size-4 text-muted" /> Model settings
                </summary>
                <div className="mt-3 space-y-3">
                  {(
                    [
                      ["lambdaJudge", "Judge shrinkage (λ judge)", "How much evidence a judge needs before their offset is trusted. Higher = more cautious."],
                      ["lambdaProject", "Project shrinkage (λ project)", "Pulls projects with few reviews toward the average."],
                    ] as const
                  ).map(([key, label, help]) => (
                    <label key={key} className="block">
                      <span className="text-xs font-semibold">{label}</span>
                      <input
                        type="number"
                        step={0.25}
                        min={0}
                        max={100}
                        value={options[key]}
                        disabled={isRun}
                        onChange={(e) =>
                          setOptions({
                            ...options,
                            [key]: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        onBlur={() => !isRun && preview(options)}
                        className={inputClass}
                      />
                      <span className="mt-1 block text-xs text-muted">{help}</span>
                    </label>
                  ))}
                  <p className="text-xs text-muted">
                    Defaults (λ judge {state.defaults.lambdaJudge}, λ project {state.defaults.lambdaProject}) were chosen by simulation; see JUDGING.md.
                  </p>
                </div>
              </details>
            </div>
          </Card>

          <Card title="Saved runs" description={state.runs.length ? undefined : "Nothing saved yet."}>
            <ul className="-my-1 divide-y divide-line">
              {state.runs.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => openRun(r.id)}
                    className={`w-full py-2.5 text-left text-sm transition hover:text-primary ${view.run?.id === r.id ? "text-primary" : ""}`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      {formatDate(r.createdAt)}
                      {r.published && <Pill tone="success">live</Pill>}
                      {r.stale && <Pill tone="warn">stale</Pill>}
                    </span>
                    <span className="block text-xs text-muted">
                      {r.createdBy ?? "system"} · {r.summary.projectsRanked} ranked
                      {r.options.excludedJudges.length > 0 && ` · ${r.options.excludedJudges.length} excluded`} ·{" "}
                      <span className="font-mono">{r.inputHash.slice(0, 8)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card padded={false}>
          <div className="flex gap-1 border-b border-line px-3 pt-2">
            {(
              [
                ["projects", `Projects (${view.projects.length})`],
                ["judges", `Judges (${view.judges.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-3.5 py-3 text-sm font-semibold transition ${tab === key ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "projects" ? (
            <ProjectsTable rows={view.projects} topK={view.summary.topK} publishedRanks={isRun ? null : (view.publishedRanks ?? null)} />
          ) : (
            <JudgesTable
              rows={view.judges}
              editable={!isRun}
              onExclude={(judgeId) => setExcluding({ judgeId, reason: "" })}
              onInclude={(judgeId) =>
                preview({
                  ...options,
                  excludedJudges: options.excludedJudges.filter((e) => e.judgeId !== judgeId),
                })
              }
            />
          )}
        </Card>
      </div>

      {excluding && (
        <ExcludeDialog
          name={view.judges.find((j) => j.judgeId === excluding.judgeId)?.name ?? "this judge"}
          busy={busy}
          onCancel={() => setExcluding(null)}
          onConfirm={async (reason) => {
            await preview({
              ...options,
              excludedJudges: [...options.excludedJudges, { judgeId: excluding.judgeId, reason }],
            });
            setExcluding(null);
            setTab("projects");
          }}
        />
      )}
    </div>
  );
}

function SummaryTiles({ view }: { view: ResultsView }) {
  const s = view.summary;
  const tiles = [
    {
      label: "Projects ranked",
      value: String(s.projectsRanked),
      sub: `${s.reviewsUsed} reviews from ${s.judgesUsed} judges${s.reviewsExcluded ? ` · ${s.reviewsExcluded} not counted (duplicates or excluded judges)` : ""}`,
    },
    {
      label: "Agreement with raw ranking",
      value: s.rankAgreement === null ? "–" : s.rankAgreement.toFixed(3),
      sub: `Spearman ρ · ${s.rankChanges} project${s.rankChanges === 1 ? "" : "s"} moved`,
    },
    {
      label: "Scoring noise",
      value: `±${s.sigma.toFixed(2)}`,
      sub: `typical disagreement per review, on 1–5`,
    },
    {
      label: "Judge groups",
      value: String(s.components),
      sub: s.components <= 1 ? "all judges comparable" : "separate groups: scores across them aren't fully comparable",
      warn: s.components > 1,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-2xl border bg-surface p-4 shadow-card ${t.warn ? "border-warn/40" : "border-line"}`}>
          <div className="font-display text-2xl font-extrabold tabular-nums">{t.value}</div>
          <div className="text-sm font-semibold text-ink-2">{t.label}</div>
          <div className={`mt-0.5 text-xs ${t.warn ? "text-warn" : "text-muted"}`}>{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function Move({ rank, raw }: { rank: number | null; raw: number | null }) {
  if (rank === null || raw === null) return null;
  const d = raw - rank;
  if (d === 0) return <Minus className="size-3.5 text-muted" aria-label="no change" />;
  return (
    <span className={`inline-flex items-center text-xs font-bold ${d > 0 ? "text-success" : "text-danger"}`} title={`#${raw} on raw averages`}>
      {d > 0 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
      {Math.abs(d)}
    </span>
  );
}

/** A 1–5 axis with the score as a dot and a 95% interval as a line. */
function Interval({ score, se }: { score: number | null; se: number | null }) {
  if (score === null || se === null) return null;
  const x = (v: number) => ((Math.min(5, Math.max(1, v)) - 1) / 4) * 100;
  return (
    <div className="relative h-4 w-28" title={`95% interval ${(score - 1.96 * se).toFixed(2)}–${(score + 1.96 * se).toFixed(2)}`}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary/30"
        style={{
          left: `${x(score - 1.96 * se)}%`,
          right: `${100 - x(score + 1.96 * se)}%`,
        }}
      />
      <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-surface" style={{ left: `${x(score)}%` }} />
    </div>
  );
}

function ProjectsTable({ rows, topK, publishedRanks }: { rows: ResultRow[]; topK: number; publishedRanks: Record<string, number | null> | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-muted">
            <th className="py-2.5 pl-5 pr-2">Rank</th>
            <th className="py-2.5 pr-3">Project</th>
            <th className="py-2.5 pr-3 text-right">Reviews</th>
            <th className="py-2.5 pr-3 text-right">Raw</th>
            <th className="py-2.5 pr-3 text-right">Adjusted</th>
            <th className="py-2.5 pr-3" />
            <th className="py-2.5 pr-3" title="Where this project lands in 90% of simulated re-judgings">
              Likely rank
            </th>
            <th className="py-2.5 pr-3 text-right" title={`Chance of finishing in the top ${topK}`}>
              Top {topK}
            </th>
            {publishedRanks && <th className="py-2.5 pr-3 text-right">Public now</th>}
            <th className="py-2.5 pr-5">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.projectId} className={r.rank === null ? "opacity-60" : ""}>
              <td className="py-2.5 pl-5 pr-2">
                <div className="flex items-center gap-2">
                  <span className="w-7 font-display text-base font-extrabold tabular-nums">{r.rank ?? "–"}</span>
                  <Move rank={r.rank} raw={r.rawRank} />
                </div>
              </td>
              <td className="max-w-[260px] py-2.5 pr-3">
                <div className="truncate font-semibold">{r.title}</div>
                <div className="truncate text-xs text-muted">
                  {r.team}
                  {r.track && ` · ${r.track.name}`}
                  {r.externalId && ` · ${r.externalId}`}
                </div>
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{r.nReviews}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{fmt(r.rawScore)}</td>
              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{fmt(r.normalizedScore)}</td>
              <td className="py-2.5 pr-3">
                <Interval score={r.normalizedScore} se={r.stdError} />
              </td>
              <td className="py-2.5 pr-3 tabular-nums text-muted">
                {r.rankLow === null ? "–" : r.rankLow === r.rankHigh ? `#${r.rankLow}` : `#${r.rankLow}–${r.rankHigh}`}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{r.pTop === null ? "–" : `${Math.round(r.pTop * 100)}%`}</td>
              {publishedRanks && (
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{publishedRanks[r.projectId] ? `#${publishedRanks[r.projectId]}` : "–"}</td>
              )}
              <td className="py-2.5 pr-5">
                <div className="flex flex-wrap gap-1">
                  {r.flags.map((f) => (
                    <Pill key={f} tone={PROJECT_FLAG[f]?.tone ?? "neutral"}>
                      <span title={PROJECT_FLAG[f]?.title}>{PROJECT_FLAG[f]?.label ?? f}</span>
                    </Pill>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JudgesTable({
  rows,
  editable,
  onExclude,
  onInclude,
}: {
  rows: JudgeStatRow[];
  editable: boolean;
  onExclude: (id: string) => void;
  onInclude: (id: string) => void;
}) {
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.offset)));
  return (
    <div className="overflow-x-auto">
      <p className="px-5 pt-4 text-xs text-muted">
        Offset = how far above (+) or below (−) the model expects this judge to score, on the 1–5 scale. It is subtracted from their reviews; everything else about their
        scores counts as they gave it.
      </p>
      <table className="mt-2 w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-muted">
            <th className="py-2.5 pl-5 pr-3">Judge</th>
            <th className="py-2.5 pr-3 text-right">Reviews</th>
            <th className="py-2.5 pr-3 text-right">Avg given</th>
            <th className="w-56 py-2.5 pr-3 text-center">Offset</th>
            <th className="py-2.5 pr-3 text-right">Spread</th>
            <th className="py-2.5 pr-3">Flags</th>
            {editable && <th className="py-2.5 pr-5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((j) => {
            const out = j.flags.includes("excluded");
            const w = (Math.abs(j.offset) / max) * 50;
            return (
              <tr key={j.judgeId} className={out ? "bg-danger-soft/40" : ""}>
                <td className="py-2.5 pl-5 pr-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={j.name} size={28} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{j.name}</div>
                      {(j.externalId || j.exclusionReason) && (
                        <div className="truncate text-xs text-muted">{j.exclusionReason ? `Excluded: ${j.exclusionReason}` : j.externalId}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{j.nReviews}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{fmt(j.rawMean)}</td>
                <td className="py-2.5 pr-3">
                  {out ? (
                    <p className="text-center text-xs text-muted">not in model</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="relative h-2.5 flex-1 rounded-full bg-surface-2">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                        <div
                          className={`absolute inset-y-0 rounded-full ${j.offset >= 0 ? "bg-accent" : "bg-primary"}`}
                          style={j.offset >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs font-semibold tabular-nums">
                        {j.offset >= 0 ? "+" : "−"}
                        {Math.abs(j.offset).toFixed(2)}
                      </span>
                    </div>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{fmt(j.stdDev)}</td>
                <td className="py-2.5 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {j.flags.map((f) => (
                      <Pill key={f} tone={JUDGE_FLAG[f]?.tone ?? "neutral"}>
                        <span title={JUDGE_FLAG[f]?.title}>{JUDGE_FLAG[f]?.label ?? f}</span>
                      </Pill>
                    ))}
                  </div>
                </td>
                {editable && (
                  <td className="py-2.5 pr-5 text-right">
                    {out ? (
                      <Button size="sm" variant="ghost" onClick={() => onInclude(j.judgeId)}>
                        <CheckCircle2 className="size-4" /> Include
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => onExclude(j.judgeId)}>
                        <UserX className="size-4" /> Exclude
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExcludeDialog({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-lift"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length >= 5) onConfirm(reason.trim());
        }}
      >
        <h2 className="text-lg font-bold">Exclude {name}?</h2>
        <p className="mt-1 text-sm text-muted">
          Their reviews stay on record but are left out of this computation. You&apos;ll see the effect on the ranking before anything is saved. The reason is stored with
          the run and in the audit log.
        </p>
        <label className="mt-4 block text-sm font-semibold">
          Reason
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Declared a conflict with two teams after scoring"
            className={inputClass}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || reason.trim().length < 5}>
            <UserX className="size-4" /> Preview without them
          </Button>
        </div>
      </form>
    </div>
  );
}
