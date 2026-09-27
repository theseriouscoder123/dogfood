"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Dices, Info, Network, Play, TriangleAlert } from "lucide-react";
import { send } from "@/lib/client";
import type { AssignPreview } from "@/lib/types";
import { Button, Card, ErrorText, Field, inputClass, Pill, SuccessText } from "@/components/ui";

const REASONS: Record<string, string> = {
  no_eligible_judges: "No judge covers this track (or all have conflicts)",
  not_enough_eligible_judges: "Fewer eligible judges than reviews needed",
  judge_cap_reached: "Every eligible judge hit the per-judge cap",
};

export function AutoAssign({ slug, submissionsClosed }: { slug: string; submissionsClosed: boolean }) {
  const router = useRouter();
  const [k, setK] = useState(3);
  const [cap, setCap] = useState<string>("");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [mode, setMode] = useState<"fill" | "simulate">("fill");
  const [preview, setPreview] = useState<AssignPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const params = () => ({ reviewsPerProject: k, maxPerJudge: cap ? Number(cap) : null, seed, mode });

  async function runPreview() {
    setPending(true);
    setNotice(null);
    const r = await send<AssignPreview>("POST", `/api/events/${slug}/assignments/preview`, params());
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setPreview(r.data);
  }

  async function runCommit() {
    if (!preview) return;
    setPending(true);
    const r = await send<{ created: number }>("POST", `/api/events/${slug}/assignments/commit`, { ...preview.params, inputHash: preview.inputHash });
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setNotice(r.data.created ? `Saved ${r.data.created} assignments. Judges will see them in their queue.` : "Nothing new to assign: every project is already covered.");
    setPreview(null);
    router.refresh();
  }

  const s = preview?.summary;
  const maxBar = preview ? Math.max(1, ...preview.judges.map((j) => j.after)) : 1;

  return (
    <Card
      title="Auto-assign"
      description="Fills every project up to the target number of reviews, respecting tracks and conflicts, balancing load, and keeping judges' work overlapping so scores can be normalized."
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Reviews per project">
          <input type="number" min={1} max={10} value={k} onChange={(e) => setK(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Max per judge" hint="Optional cap">
          <input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="No cap" className={inputClass} />
        </Field>
        <Field label="Seed" hint="Same seed, same plan">
          <div className="relative">
            <input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} className={`${inputClass} pr-10`} />
            <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))} className="absolute right-2 top-1/2 mt-[3px] -translate-y-1/2 rounded-md p-1 text-muted hover:text-ink" aria-label="New random seed">
              <Dices className="size-4" />
            </button>
          </div>
        </Field>
        <Field label="Mode">
          <select value={mode} onChange={(e) => setMode(e.target.value as "fill" | "simulate")} className={inputClass}>
            <option value="fill">Fill gaps (keeps existing)</option>
            <option value="simulate">Simulate from scratch</option>
          </select>
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => void runPreview()} disabled={pending}>
          <Play className="size-4" /> Preview plan
        </Button>
        {!submissionsClosed && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <Info className="size-4" /> Submissions are still open: you can preview, and save once the deadline passes.
          </span>
        )}
      </div>

      {preview && s && (
        <div className="mt-6 space-y-5 border-t border-line pt-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label={preview.params.mode === "simulate" ? "Assignments (simulated)" : "New assignments"} value={s.newAssignments} />
            <Stat label="Covered after saving" value={`${s.projects - s.shortfalls}/${s.projects}`} tone={s.shortfalls ? "warn" : "success"} />
            <Stat label="Reviews per judge" value={`${s.loadAfter.min}–${s.loadAfter.max}`} sub={`was ${s.loadBefore.min}–${s.loadBefore.max} · σ ${s.loadAfter.stdev}`} />
            <Stat
              label="Judge groups"
              value={s.components}
              tone={s.components > 1 ? "warn" : "success"}
              sub={s.components > 1 ? "scores not fully comparable" : "all judges comparable"}
            />
          </div>

          {s.components > 1 && (
            <p className="flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">
              <Network className="mt-0.5 size-4 shrink-0" />
              Judges split into {s.components} groups that never review the same projects, so their generosity can&apos;t be compared across groups. Give a judge a
              second track to bridge them.
            </p>
          )}

          <div>
            <p className="mb-2 text-sm font-bold">Reviews per judge</p>
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-2">
              {preview.judges.map((j) => (
                <div key={j.id} className="grid grid-cols-[160px_1fr_48px] items-center gap-3 text-sm">
                  <span className="truncate text-ink-2">{j.name}</span>
                  <div className="flex h-3.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-line-strong" style={{ width: `${(Math.min(j.before, j.after) / maxBar) * 100}%` }} title={`${j.before} existing`} />
                    <div className="h-full bg-primary" style={{ width: `${(Math.max(0, j.after - j.before) / maxBar) * 100}%` }} title={`${j.after - j.before} new`} />
                  </div>
                  <span className="text-right font-semibold tabular-nums">{j.after}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 flex gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-line-strong" /> existing
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-primary" /> new in this plan
              </span>
            </p>
          </div>

          {preview.shortfalls.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-bold">Projects that can&apos;t be fully covered</p>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {preview.shortfalls.map((x) => (
                  <li key={x.projectId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <TriangleAlert className="size-4 shrink-0 text-warn" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{x.projectTitle}</span>
                    {x.track && <Pill>{x.track}</Pill>}
                    <span className="tabular-nums text-muted">
                      {x.have}/{x.need}
                    </span>
                    <span className="hidden text-xs text-muted md:inline">{REASONS[x.reason] ?? x.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="accent" size="lg" onClick={() => void runCommit()} disabled={pending || !preview.canCommit || s.newAssignments === 0}>
              <CircleCheck className="size-4" /> Save {s.newAssignments} assignments
            </Button>
            <span className="text-sm text-muted">
              {preview.params.mode === "simulate"
                ? "Simulations are for comparison only."
                : !preview.canCommit
                  ? "Saving unlocks after the submission deadline."
                  : `Seed ${preview.params.seed}. Saving uses exactly this plan.`}
            </span>
          </div>
        </div>
      )}
      <div className="mt-4 space-y-2">
        <ErrorText>{error}</ErrorText>
        <SuccessText>{notice}</SuccessText>
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "success" | "warn" }) {
  return (
    <div className={`rounded-xl border p-3.5 ${tone === "warn" ? "border-warn/30 bg-warn-soft" : tone === "success" ? "border-success/25 bg-success-soft" : "border-line bg-surface-2"}`}>
      <div className={`font-display text-2xl font-extrabold ${tone === "warn" ? "text-warn" : tone === "success" ? "text-success" : "text-ink"}`}>{value}</div>
      <div className="text-xs font-semibold text-ink-2">{label}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
