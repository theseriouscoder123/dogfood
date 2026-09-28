"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BellRing, CheckCircle2, Clock, Gavel, Layers, Mail, Shuffle, X } from "lucide-react";
import { send } from "@/lib/client";
import type { JudgingProgress, Pace, ProgressJudge, RedistributePreview } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Countdown } from "@/components/Countdown";
import { Button, Card, EmptyState, ErrorText, Pill, SuccessText } from "@/components/ui";
import { Avatar } from "@/components/visuals";

const REFRESH_MS = 15_000;
const REMIND_COOLDOWN_MS = 6 * 3_600_000;

const PACE: Record<Pace, { label: string; tone: "neutral" | "primary" | "success" | "warn" | "danger" }> = {
  done: { label: "Done", tone: "success" },
  on_track: { label: "On track", tone: "primary" },
  behind: { label: "Behind", tone: "warn" },
  not_started: { label: "Not started", tone: "neutral" },
  missed: { label: "Missed deadline", tone: "danger" },
  waiting: { label: "Waiting for judging", tone: "neutral" },
  unassigned: { label: "No assignments", tone: "neutral" },
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function ProgressBoard({ slug, initial }: { slug: string; initial: JudgingProgress }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => new Date(initial.generatedAt).getTime());
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState<"all" | "stragglers" | "active" | "done">(initial.totals.stragglers ? "stragglers" : "all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [redistribute, setRedistribute] = useState<RedistributePreview | null>(null);
  const base = `/api/events/${slug}`;

  const refresh = useCallback(async () => {
    const r = await send<JudgingProgress>("GET", `${base}/progress`);
    if (r.ok) {
      setData(r.data);
      setStale(false);
    } else setStale(true);
  }, [base]);

  // Poll while the tab is visible; catch up immediately when it becomes visible again.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => document.visibilityState === "visible" && refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const t = data.totals;
  const open = data.judgingWindow === "open";
  const canRemind = (j: ProgressJudge) =>
    data.judgingWindow !== "closed" && j.active > j.submitted && !(j.lastRemindedAt && now - new Date(j.lastRemindedAt).getTime() < REMIND_COOLDOWN_MS);

  const judges = useMemo(
    () =>
      data.judges.filter((j) =>
        filter === "stragglers" ? j.straggler : filter === "done" ? j.pace === "done" : filter === "active" ? j.active > j.submitted : true,
      ),
    [data.judges, filter],
  );
  const selectable = judges.filter(canRemind);
  const selectedIds = [...selected].filter((id) => data.judges.some((j) => j.id === id && canRemind(j)));

  async function remind(ids: string[]) {
    setBusy(true);
    const r = await send<{ sent: string[]; skipped: Array<{ judgeId: string; reason: string }> }>("POST", `${base}/progress/remind`, { judgeIds: ids });
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    const skipped = r.data.skipped.length ? `, skipped ${r.data.skipped.length} (${[...new Set(r.data.skipped.map((s) => s.reason))].join(", ")})` : "";
    setNotice({ ok: true, text: `Reminder sent to ${r.data.sent.length} judge${r.data.sent.length === 1 ? "" : "s"}${skipped}.` });
    setSelected(new Set());
    refresh();
  }

  async function previewRedistribute(judgeId: string) {
    setBusy(true);
    const r = await send<RedistributePreview>("POST", `${base}/judges/${judgeId}/redistribute`, {});
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    setNotice(null);
    setRedistribute(r.data);
  }

  async function commitRedistribute() {
    if (!redistribute) return;
    setBusy(true);
    const r = await send<{ released: number; created: number; unplaced: number }>("POST", `${base}/judges/${redistribute.judge.id}/redistribute`, {
      commit: true,
      inputHash: redistribute.inputHash,
      seed: redistribute.seed,
    });
    setBusy(false);
    if (!r.ok) {
      setRedistribute(null);
      return setNotice({ ok: false, text: r.message });
    }
    setNotice({ ok: true, text: `Moved ${r.data.released} review${r.data.released === 1 ? "" : "s"} away from ${redistribute.judge.name}: ${r.data.created} new assignment${r.data.created === 1 ? "" : "s"}${r.data.unplaced ? `, ${r.data.unplaced} project(s) still short` : ""}.` });
    setRedistribute(null);
    refresh();
  }

  if (t.reviews === 0 && t.recused === 0) {
    return (
      <EmptyState icon={<Gavel className="size-5" />} title="No assignments yet" action={<Link href={`/events/${slug}/manage/assignments`} className="text-sm font-semibold text-primary hover:underline">Assign judges →</Link>}>
        Progress appears here once judges have projects to review.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className={`inline-flex items-center gap-2 font-semibold ${stale ? "text-warn" : "text-success"}`}>
          <span className="relative flex size-2.5">
            {!stale && open && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
            <span className={`relative inline-flex size-2.5 rounded-full ${stale ? "bg-warn" : "bg-success"}`} />
          </span>
          {stale ? "Reconnecting…" : open ? "Live" : "Up to date"}
        </span>
        <span className="text-muted">Updated {ago(data.generatedAt, now)} · refreshes every 15 seconds</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={<CheckCircle2 className="size-5" />} label="Reviews submitted" value={`${t.submitted}/${t.reviews}`} sub={`${pct(t.submitted, t.reviews)}% done · ${t.inProgress} in progress`} bar={pct(t.submitted, t.reviews)} />
        <Tile icon={<Layers className="size-5" />} label={`Projects with ${data.target}+ reviews`} value={`${t.projectsComplete}/${t.projects}`} sub={t.projectsUnreviewed ? `${t.projectsUnreviewed} with no reviews yet` : "every project has a review"} bar={pct(t.projectsComplete, t.projects)} />
        <Tile icon={<Gavel className="size-5" />} label="Judges finished" value={`${t.judgesDone}/${t.judges}`} sub={t.recused ? `${t.recused} recusal${t.recused === 1 ? "" : "s"}` : "no recusals"} bar={pct(t.judgesDone, t.judges)} />
        <Tile
          icon={<AlertTriangle className="size-5" />}
          label="Judges behind"
          value={String(t.stragglers)}
          sub={t.stragglers ? "remind or redistribute below" : "everyone is on pace"}
          tone={t.stragglers ? "warn" : "success"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Reviews over time" description={data.window.closesAt ? "Submitted reviews against a steady pace to the deadline." : "Submitted reviews so far."}>
          <Timeline data={data} now={now} />
        </Card>
        <Card title={open ? "Judging closes in" : data.judgingWindow === "not_open" ? "Judging opens in" : "Judging closed"}>
          {open && data.window.closesAt ? (
            <Countdown to={data.window.closesAt} />
          ) : data.judgingWindow === "not_open" ? (
            <Countdown to={data.window.opensAt} />
          ) : (
            <p className="text-sm text-muted">{data.window.closesAt ? formatDate(data.window.closesAt) : "No end date set."}</p>
          )}
          <div className="mt-5 space-y-2 text-sm">
            <StatusBar submitted={t.submitted} inProgress={t.inProgress} notStarted={t.notStarted} />
            {[
              ["bg-success", "Submitted", t.submitted],
              ["bg-primary", "Draft saved", t.inProgress],
              ["bg-line-strong", "Not started", t.notStarted],
            ].map(([cls, label, n]) => (
              <div key={String(label)} className="flex items-center gap-2">
                <span className={`size-2.5 rounded-sm ${cls}`} />
                <span className="flex-1 text-ink-2">{label}</span>
                <span className="font-semibold tabular-nums">{n}</span>
              </div>
            ))}
          </div>
          <Link href={`/events/${slug}/manage/schedule`} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Change the deadline <ArrowRight className="size-4" />
          </Link>
        </Card>
      </div>

      {notice && (notice.ok ? <SuccessText>{notice.text}</SuccessText> : <ErrorText>{notice.text}</ErrorText>)}

      <Card
        title="Judges"
        description="Behind: 20+ points under pace. Not started: after 20% of judging time."
        padded={false}
      >
        <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-line px-5 pb-4 sm:px-6">
          {(
            [
              ["stragglers", `Behind (${t.stragglers})`],
              ["active", `Still reviewing (${data.judges.filter((j) => j.active > j.submitted).length})`],
              ["done", `Done (${t.judgesDone})`],
              ["all", `All (${t.judges})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${filter === key ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
          {data.judgingWindow !== "closed" && (
            <Button size="sm" variant="secondary" className="ml-auto" disabled={busy || selectedIds.length === 0} onClick={() => remind(selectedIds)}>
              <BellRing className="size-4" /> Remind selected ({selectedIds.length})
            </Button>
          )}
        </div>
        {judges.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted">{filter === "stragglers" ? "Nobody is behind. 🎉" : "No judges match this filter."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  <th className="w-12 py-2.5 pl-5 pr-2 sm:pl-6">
                    {data.judgingWindow !== "closed" && (
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        className="size-4 accent-[var(--primary)]"
                        disabled={selectable.length === 0}
                        checked={selectable.length > 0 && selectable.every((j) => selected.has(j.id))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((j) => j.id)) : new Set())}
                      />
                    )}
                  </th>
                  <th className="py-2.5 pr-3">Judge</th>
                  <th className="w-56 py-2.5 pr-3">Progress</th>
                  <th className="py-2.5 pr-3">Pace</th>
                  <th className="py-2.5 pr-3">Last active</th>
                  <th className="py-2.5 pr-3" title="Median time from opening a project to submitting its review">Per review</th>
                  <th className="py-2.5 pr-5 text-right sm:pr-6">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {judges.map((j) => (
                  <tr key={j.id} className={j.straggler ? "bg-warn-soft/40" : ""}>
                    <td className="py-3 pl-5 pr-2 sm:pl-6">
                      {canRemind(j) && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${j.name}`}
                          className="size-4 accent-[var(--primary)]"
                          checked={selected.has(j.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(j.id);
                            else next.delete(j.id);
                            setSelected(next);
                          }}
                        />
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={j.name} size={30} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{j.name}</div>
                          <div className="truncate text-xs text-muted">
                            {j.tracks.length ? j.tracks.join(", ") : "All tracks"}
                            {j.externalId && ` · ${j.externalId}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <StatusBar submitted={j.submitted} inProgress={j.inProgress} notStarted={j.notStarted} />
                        <span className="w-12 shrink-0 text-right font-semibold tabular-nums">
                          {j.submitted}/{j.active}
                        </span>
                      </div>
                      {j.recused > 0 && <div className="mt-0.5 text-xs text-muted">{j.recused} recused</div>}
                    </td>
                    <td className="py-3 pr-3">
                      <Pill tone={PACE[j.pace].tone}>{PACE[j.pace].label}</Pill>
                    </td>
                    <td className="py-3 pr-3 text-muted" title={j.lastActivityAt ? formatDate(j.lastActivityAt) : undefined}>
                      {ago(j.lastActivityAt, now)}
                    </td>
                    <td className="py-3 pr-3 tabular-nums text-muted">{j.medianMinutes === null ? "–" : j.medianMinutes < 1 ? "<1 min" : `${Math.round(j.medianMinutes)} min`}</td>
                    <td className="py-3 pr-5 text-right sm:pr-6">
                      <div className="flex justify-end gap-1.5">
                        {j.active > j.submitted && data.judgingWindow !== "closed" && (
                          <Button size="sm" variant="ghost" disabled={busy || !canRemind(j)} onClick={() => remind([j.id])} title={j.lastRemindedAt ? `Last reminded ${formatDate(j.lastRemindedAt)}` : "Email this judge a reminder"}>
                            <Mail className="size-4" /> {j.lastRemindedAt && !canRemind(j) ? `Reminded ${ago(j.lastRemindedAt, now)}` : "Remind"}
                          </Button>
                        )}
                        {j.notStarted > 0 && data.judgingWindow !== "closed" && (
                          <Button size="sm" variant={j.straggler ? "secondary" : "ghost"} disabled={busy} onClick={() => previewRedistribute(j.id)} title="Give this judge's untouched reviews to other judges">
                            <Shuffle className="size-4" /> Redistribute
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="By track">
          <ul className="space-y-4">
            {data.tracks.map((tr) => (
              <li key={tr.id ?? "none"}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-semibold">{tr.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {tr.submitted}/{tr.assigned} reviews · {tr.complete}/{tr.projects} projects complete
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${pct(tr.submitted, tr.assigned)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Projects that need attention"
          description={data.attention.length ? `${data.attention.length} project${data.attention.length === 1 ? "" : "s"} may miss ${data.target} reviews.` : undefined}
          actions={
            <Link href={`/events/${slug}/manage/assignments`} className="shrink-0 text-sm font-semibold text-primary hover:underline">
              Assignments →
            </Link>
          }
        >
          {data.attention.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <CheckCircle2 className="size-4 text-success" /> Every project is covered and nobody it depends on is behind.
            </p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {data.attention.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-semibold">{p.title}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                      {p.submitted}/{data.target}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {p.team}
                    {p.track && ` · ${p.track}`}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.reasons.map((r) => (
                      <Pill key={r} tone="warn">
                        {r}
                      </Pill>
                    ))}
                    {p.pending.map((a) => (
                      <Pill key={a.assignmentId} tone={a.straggler ? "danger" : "neutral"}>
                        <Clock className="size-3" /> {a.judge}
                      </Pill>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {redistribute && <RedistributeDialog preview={redistribute} busy={busy} onCancel={() => setRedistribute(null)} onConfirm={commitRedistribute} />}
    </div>
  );
}

function Tile({ icon, label, value, sub, bar, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; bar?: number; tone?: "warn" | "success" }) {
  return (
    <div className={`rounded-2xl border bg-surface p-5 shadow-card ${tone === "warn" ? "border-warn/40" : "border-line"}`}>
      <div className={tone === "warn" ? "text-warn" : tone === "success" ? "text-success" : "text-muted"}>{icon}</div>
      <div className="mt-3 font-display text-3xl font-extrabold tabular-nums">{value}</div>
      <div className="text-sm font-semibold text-ink-2">{label}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
      {bar !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-[#9b6bff] transition-[width] duration-700" style={{ width: `${bar}%` }} />
        </div>
      )}
    </div>
  );
}

function StatusBar({ submitted, inProgress, notStarted }: { submitted: number; inProgress: number; notStarted: number }) {
  const total = submitted + inProgress + notStarted || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="bg-success transition-[width] duration-700" style={{ width: `${(submitted / total) * 100}%` }} />
      <div className="bg-primary transition-[width] duration-700" style={{ width: `${(inProgress / total) * 100}%` }} />
      <div className="bg-line-strong transition-[width] duration-700" style={{ width: `${(notStarted / total) * 100}%` }} />
    </div>
  );
}

/** Cumulative submitted reviews, a dashed steady-pace line to the deadline, and a "now" marker. */
function Timeline({ data, now }: { data: JudgingProgress; now: number }) {
  const W = 640, H = 220, L = 36, R = 12, T = 12, B = 28;
  const start = new Date(data.timeline.start).getTime();
  const end = Math.max(new Date(data.timeline.end).getTime(), start + 1);
  const total = Math.max(data.totals.reviews, 1);
  const x = (ms: number) => L + ((Math.min(Math.max(ms, start), end) - start) / (end - start)) * (W - L - R);
  const y = (n: number) => H - B - (n / total) * (H - T - B);
  const pts = data.timeline.points.filter((p) => p.n !== null).map((p) => [x(new Date(p.t).getTime()), y(p.n!)] as const);
  if (pts.length === 0) return <p className="text-sm text-muted">No reviews yet.</p>;
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)![0].toFixed(1)},${y(0)} L${pts[0]![0].toFixed(1)},${y(0)} Z`;
  const opens = new Date(data.window.opensAt).getTime();
  const closes = data.window.closesAt ? new Date(data.window.closesAt).getTime() : null;
  const showNow = now > start && now < end;
  const last = data.timeline.points.filter((p) => p.n !== null).at(-1)!;
  const dateLabel = (ms: number) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(ms);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${last.n} of ${data.totals.reviews} reviews submitted`}>
        <defs>
          <linearGradient id="tl-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(total * f)} y2={y(total * f)} stroke="var(--line)" strokeDasharray={f ? "3 4" : undefined} />
            <text x={L - 8} y={y(total * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {Math.round(total * f)}
            </text>
          </g>
        ))}
        {closes && <line x1={x(opens)} y1={y(0)} x2={x(closes)} y2={y(total)} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.7" />}
        <path d={area} fill="url(#tl-fill)" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {showNow && (
          <g>
            <line x1={x(now)} x2={x(now)} y1={T} y2={y(0)} stroke="var(--accent)" strokeWidth="1.5" />
            <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="4.5" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2.5" />
            <text x={x(now)} y={T + 10} dx={x(now) > W - 80 ? -6 : 6} textAnchor={x(now) > W - 80 ? "end" : "start"} fontSize="11" fontWeight="600" fill="var(--accent)">
              now
            </text>
          </g>
        )}
        <text x={L} y={H - 8} fontSize="11" fill="var(--muted)">
          {dateLabel(start)}
        </text>
        <text x={W - R} y={H - 8} textAnchor="end" fontSize="11" fill="var(--muted)">
          {dateLabel(end)}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-primary" /> Submitted reviews
        </span>
        {closes && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-muted" /> Steady pace
          </span>
        )}
        <span className="ml-auto">times in UTC</span>
      </figcaption>
    </figure>
  );
}

function RedistributeDialog({ preview, busy, onCancel, onConfirm }: { preview: RedistributePreview; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="redistribute-title" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="redistribute-title" className="text-lg font-bold">
              Redistribute {preview.judge.name}&apos;s reviews
            </h2>
            <p className="mt-1 text-sm text-muted">
              {preview.released.length} untouched review{preview.released.length === 1 ? "" : "s"} will move to other judges, chosen by the assignment engine with the same rules
              (tracks, conflicts, balanced load). Reviews they have started stay with them.
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink">
            <X className="size-5" />
          </button>
        </div>

        <ul className="mt-5 divide-y divide-line rounded-xl border border-line">
          {preview.moves.map((m) => (
            <li key={`${m.projectId}-${m.judgeId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold">{m.title}</span>
              <ArrowRight className="size-4 shrink-0 text-muted" />
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={m.judge} size={22} />
                <span className="truncate">{m.judge}</span>
                <span className="shrink-0 text-xs text-muted">({m.loadAfter} total)</span>
              </span>
            </li>
          ))}
          {preview.moves.length === 0 && <li className="px-4 py-3 text-sm text-muted">No other judge can take these projects.</li>}
        </ul>

        {preview.unplaced.length > 0 && (
          <p className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
            {preview.unplaced.length} project{preview.unplaced.length === 1 ? "" : "s"} will stay below {preview.target} reviews:{" "}
            {preview.unplaced.map((u) => u.title).join(", ")}. No other eligible judge is available.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            <Shuffle className="size-4" /> {busy ? "Moving…" : "Move reviews"}
          </Button>
        </div>
      </div>
    </div>
  );
}
