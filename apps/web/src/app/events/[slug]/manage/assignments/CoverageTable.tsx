"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { send } from "@/lib/client";
import type { AssignmentStatus, CoverageRow } from "@/lib/types";
import { Button, Card, ErrorText, inputClass, Pill } from "@/components/ui";

type Eligible = { id: string; name: string; load: number; eligible: boolean; reason: string | null };

const STATUS: Record<AssignmentStatus, { label: string; cls: string }> = {
  assigned: { label: "Assigned", cls: "border-line bg-surface-2 text-ink-2" },
  in_progress: { label: "In progress", cls: "border-primary/25 bg-primary-soft text-primary" },
  submitted: { label: "Submitted", cls: "border-success/25 bg-success-soft text-success" },
  recused: { label: "Recused", cls: "border-line bg-surface text-muted line-through" },
};

export function CoverageTable({ slug, rows, target, canEdit }: { slug: string; rows: CoverageRow[]; target: number; canEdit: boolean }) {
  const router = useRouter();
  const [track, setTrack] = useState("");
  const [attention, setAttention] = useState(false);
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState<{ projectId: string; assignmentId?: string; options: Eligible[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const base = `/api/events/${slug}`;

  const tracks = useMemo(() => [...new Map(rows.filter((r) => r.track).map((r) => [r.track!.id, r.track!.name])).entries()], [rows]);
  const needsAttention = (r: CoverageRow) => !r.duplicate && (r.active < target || r.assignments.some((a) => a.conflict && a.status !== "recused"));
  const shown = rows.filter((r) => (!track || r.track?.id === track) && (!attention || needsAttention(r)) && (!q || r.title.toLowerCase().includes(q.toLowerCase())));
  const covered = rows.filter((r) => !r.duplicate && r.active >= target).length;
  const judgeable = rows.filter((r) => !r.duplicate).length;

  async function openPicker(projectId: string, assignmentId?: string) {
    const r = await send<{ judges: Eligible[] }>("GET", `${base}/assignments/eligible?projectId=${projectId}`);
    if (!r.ok) return setError(r.message);
    setPicker({ projectId, assignmentId, options: r.data.judges });
  }

  async function act(method: string, path: string, body?: unknown) {
    setPending(true);
    const r = await send(method, path, body);
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setPicker(null);
    router.refresh();
  }

  return (
    <Card title="Coverage" description={`${covered} of ${judgeable} projects have at least ${target} active reviewers.`} padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 pb-4 sm:px-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a project" className={`${inputClass} mt-0 w-56`} />
        <select value={track} onChange={(e) => setTrack(e.target.value)} className={`${inputClass} mt-0 w-48`}>
          <option value="">All tracks</option>
          {tracks.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="ml-1 inline-flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Needs attention ({rows.filter(needsAttention).length})
        </label>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((r) => (
          <li key={r.id} className={`px-5 py-3.5 sm:px-6 ${r.duplicate ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1 basis-60">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{r.title}</span>
                  {r.duplicate && <Pill tone="danger">duplicate, not judged</Pill>}
                </div>
                <div className="text-xs text-muted">
                  {r.team}
                  {r.track && ` · ${r.track.name}`}
                  {r.externalId && ` · ${r.externalId}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.assignments.map((a) => (
                  <span key={a.id} className={`group inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-semibold ${STATUS[a.status].cls}`}>
                    {a.conflict && a.status !== "recused" && <ShieldAlert className="size-3.5 text-danger" aria-label="conflict of interest" />}
                    <span title={a.recusalReason ?? STATUS[a.status].label}>{a.judge.name}</span>
                    {canEdit && a.status !== "submitted" && (
                      <>
                        <button type="button" onClick={() => void openPicker(r.id, a.id)} className="rounded-full p-0.5 hover:bg-black/5" aria-label={`Reassign from ${a.judge.name}`}>
                          <ArrowRightLeft className="size-3" />
                        </button>
                        {a.status !== "recused" && (
                          <button type="button" onClick={() => void act("DELETE", `${base}/assignments/${a.id}`)} className="rounded-full p-0.5 hover:bg-black/5" aria-label={`Remove ${a.judge.name}`}>
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </>
                    )}
                  </span>
                ))}
                {canEdit && !r.duplicate && (
                  <button type="button" onClick={() => void openPicker(r.id)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-xs font-semibold text-muted hover:border-primary hover:text-primary">
                    <Plus className="size-3" /> Judge
                  </button>
                )}
              </div>
              {!r.duplicate &&
                (r.active < target ? (
                  <Pill tone={r.active === 0 ? "danger" : "warn"}>needs {target - r.active} more</Pill>
                ) : (
                  <Pill tone={r.submitted >= r.active ? "success" : "neutral"}>
                    {r.submitted}/{r.active} reviewed
                  </Pill>
                ))}
            </div>

            {picker?.projectId === r.id && (
              <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between text-sm font-bold">
                  {picker.assignmentId ? "Reassign to…" : "Add a judge"}
                  <button type="button" onClick={() => setPicker(null)} aria-label="Close">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                  {picker.options.map((j) => (
                    <button
                      type="button"
                      key={j.id}
                      disabled={!j.eligible || pending}
                      title={j.reason ?? `${j.load} reviews`}
                      onClick={() =>
                        void (picker.assignmentId
                          ? act("POST", `${base}/assignments/${picker.assignmentId}/reassign`, { judgeId: j.id })
                          : act("POST", `${base}/assignments`, { judgeId: j.id, projectId: r.id }))
                      }
                      className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold enabled:hover:border-primary enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {j.name} <span className="font-normal text-muted">· {j.eligible ? `${j.load} reviews` : j.reason}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="px-6 py-10 text-center text-sm text-muted">No projects match.</li>}
      </ul>
      <div className="px-5 pb-5 sm:px-6">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}
