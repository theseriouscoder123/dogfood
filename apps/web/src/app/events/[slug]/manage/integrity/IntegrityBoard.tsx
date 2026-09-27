"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ExternalLink, FileText, MessageSquareWarning, RotateCcw, ShieldCheck, Timer, TrendingDown, Copy, Equal, Users, UserX } from "lucide-react";
import { send } from "@/lib/client";
import type { IntegrityFlag, IntegrityFlagType, IntegrityReport } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Card, EmptyState, ErrorText, inputClass, Pill } from "@/components/ui";
import { Avatar } from "@/components/visuals";

const TYPE: Record<IntegrityFlagType, { label: string; icon: typeof AlertTriangle; why: string }> = {
  outlier: { label: "Outlier score", icon: TrendingDown, why: "Far from what this judge's habits and the other reviews of the project predict." },
  comment_mismatch: { label: "Comment contradicts score", icon: MessageSquareWarning, why: "The words and the numbers disagree, which often means a slip when entering scores." },
  identical_criteria: { label: "Same score on every criterion", icon: Equal, why: "The rubric's criteria aren't being judged separately (halo effect)." },
  low_discrimination: { label: "Scores barely vary", icon: Equal, why: "A judge who rates everything alike adds little to the ranking." },
  disagrees_with_panel: { label: "Opposite to other judges", icon: Users, why: "Scores high where the other judges score low, and the reverse." },
  rushed: { label: "Rushed review", icon: Timer, why: "Submitted within a minute of first opening the project." },
  fast_reviewer: { label: "Consistently fast", icon: Timer, why: "Most reviews submitted in under two minutes." },
  copy_paste: { label: "Pasted comment", icon: Copy, why: "The same comment on several projects." },
};
const SEVERITY = { high: "bg-danger", medium: "bg-warn", low: "bg-line-strong" } as const;

export function IntegrityBoard({ slug, data }: { slug: string; data: IntegrityReport }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"open" | "resolved" | IntegrityFlagType>("open");
  const [editing, setEditing] = useState<{ key: string; status: "dismissed" | "confirmed"; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = data.summary;
  const rel = data.reliability;

  const shown = data.flags.filter((f) => (filter === "open" ? !f.resolution : filter === "resolved" ? !!f.resolution : f.type === filter));
  const types = (Object.keys(TYPE) as IntegrityFlagType[]).filter((t) => s.byType[t]);

  async function decide(key: string, status: "dismissed" | "confirmed" | "open", note = "") {
    setBusy(true);
    const r = await send("POST", `/api/events/${slug}/integrity/resolve`, { flagKey: key, status, note });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile value={String(s.open)} label="Open flags" sub={`${s.flags - s.open} decided · ${s.flags} total`} tone={s.open ? "warn" : "success"} />
        <Tile value={String(s.reviewsChecked)} label="Reviews checked" sub={`from ${s.judges} judges · ${s.commentedReviews} with comments`} />
        <Tile
          value={rel ? rel.average.toFixed(2) : "–"}
          label="Panel reliability"
          sub={rel ? (rel.reliable ? `judges broadly agree (ICC over ~${rel.reviewsPerProject} reviews)` : "judges barely agree: treat close ranks as ties") : "needs projects with 2+ reviews"}
          tone={rel && !rel.reliable ? "warn" : undefined}
        />
        <Tile value={`${s.reviewsChecked ? Math.round((s.timedReviews / s.reviewsChecked) * 100) : 0}%`} label="Reviews with timing" sub={s.timedReviews ? "time from opening to submitting" : "no timing data (imported reviews)"} />
      </div>

      {rel && !rel.reliable && (
        <div className="flex gap-3 rounded-2xl border border-warn/40 bg-warn-soft px-5 py-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
          <div>
            <p className="font-bold text-ink">Judges agree with each other little more than chance (ICC(1,k) = {rel.average.toFixed(2)})</p>
            <p className="mt-0.5 text-ink-2">
              Two reviews of the same project differ about as much as reviews of different projects. Normalization removes judge leniency, but it can&apos;t create agreement
              that isn&apos;t there. Consider more reviews per project, clearer rubric guidance, or calibrating judges on a shared sample before prizes are decided.
            </p>
          </div>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["open", `Open (${s.open})`],
            ...types.map((t) => [t, `${TYPE[t].label} (${s.byType[t]})`] as const),
            ["resolved", `Decided (${s.flags - s.open})`],
          ] as Array<readonly [typeof filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${filter === key ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title={filter === "open" ? "Nothing left to review" : "No flags here"}>
          {filter === "open" ? "Every flag has a decision, or nothing looked unusual." : "Try another filter."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {shown.map((f) => (
            <FlagCard
              key={f.key}
              slug={slug}
              flag={f}
              busy={busy}
              editing={editing?.key === f.key ? editing : null}
              onEdit={(status) => setEditing({ key: f.key, status, note: "" })}
              onNote={(note) => setEditing((e) => (e ? { ...e, note } : e))}
              onCancel={() => setEditing(null)}
              onSave={() => editing && decide(editing.key, editing.status, editing.note)}
              onReopen={() => decide(f.key, "open")}
            />
          ))}
        </ul>
      )}

      <Card>
        <p className="flex items-start gap-3 text-sm text-muted">
          <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            These checks are plain statistics, not AI: every flag shows the numbers behind it, and none of them changes a score. Thresholds and reasoning are in JUDGING.md. To
            act on a flag, exclude the judge from a results run (with a reason), reassign, or talk to them, then record your decision here.
          </span>
        </p>
      </Card>
    </div>
  );
}

function Tile({ value, label, sub, tone }: { value: string; label: string; sub: string; tone?: "warn" | "success" }) {
  return (
    <div className={`rounded-2xl border bg-surface p-4 shadow-card ${tone === "warn" ? "border-warn/40" : "border-line"}`}>
      <div className={`font-display text-2xl font-extrabold tabular-nums ${tone === "warn" ? "text-warn" : tone === "success" ? "text-success" : ""}`}>{value}</div>
      <div className="text-sm font-semibold text-ink-2">{label}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
    </div>
  );
}

function Evidence({ flag }: { flag: IntegrityFlag }) {
  const e = flag.evidence;
  if (flag.type === "comment_mismatch" || flag.type === "copy_paste")
    return (
      <blockquote className="mt-2 rounded-lg border-l-4 border-line-strong bg-surface-2 px-3 py-2 text-sm italic text-ink-2">
        &ldquo;{String(e.comment)}&rdquo;
        {flag.type === "comment_mismatch" && <span className="ml-2 not-italic text-muted">· scored {String(e.score)} / 5</span>}
      </blockquote>
    );
  if (flag.type === "outlier")
    return (
      <p className="mt-2 text-sm text-ink-2">
        Scored <b>{String(e.score)}</b>, expected about <b>{String(e.expected)}</b>
      </p>
    );
  return null;
}

function FlagCard(props: {
  slug: string;
  flag: IntegrityFlag;
  busy: boolean;
  editing: { status: "dismissed" | "confirmed"; note: string } | null;
  onEdit: (s: "dismissed" | "confirmed") => void;
  onNote: (n: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onReopen: () => void;
}) {
  const { slug, flag: f, editing } = props;
  const T = TYPE[f.type];
  return (
    <li className={`rounded-2xl border bg-surface p-5 shadow-card ${f.resolution ? "border-line opacity-80" : "border-line"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
          <T.icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`size-2 rounded-full ${SEVERITY[f.severity]}`} title={`${f.severity} priority`} />
            <h3 className="font-bold">{T.label}</h3>
            {f.resolution && <Pill tone={f.resolution.status === "confirmed" ? "danger" : "success"}>{f.resolution.status === "confirmed" ? "confirmed" : "dismissed"}</Pill>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Avatar name={f.judge.name} size={20} /> {f.judge.name}
              {f.judge.externalId && <span className="font-normal text-muted">{f.judge.externalId}</span>}
            </span>
            {f.project && (
              <Link href={`/events/${slug}/projects/${f.project.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                {f.project.title} <ExternalLink className="size-3.5" />
              </Link>
            )}
          </div>
          <p className="mt-2 text-sm text-ink-2">{f.summary}</p>
          <Evidence flag={f} />
          <p className="mt-2 text-xs text-muted">{T.why}</p>

          {f.resolution && (
            <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              {f.resolution.note && <p className="text-ink-2">{f.resolution.note}</p>}
              <p className="text-xs text-muted">
                {f.resolution.by ?? "Someone"} · {formatDate(f.resolution.at)}
              </p>
            </div>
          )}

          {editing && (
            <div className="mt-3">
              <textarea
                autoFocus
                rows={2}
                value={editing.note}
                onChange={(e) => props.onNote(e.target.value)}
                placeholder={editing.status === "dismissed" ? "Why is this fine? (required)" : "What did you do about it? (optional)"}
                className={inputClass}
              />
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={props.onSave} disabled={props.busy || (editing.status === "dismissed" && editing.note.trim().length < 3)}>
                  <Check className="size-4" /> {editing.status === "dismissed" ? "Dismiss flag" : "Mark confirmed"}
                </Button>
                <Button size="sm" variant="secondary" onClick={props.onCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {!editing && (
          <div className="flex flex-wrap gap-1.5">
            {f.resolution ? (
              <Button size="sm" variant="ghost" onClick={props.onReopen} disabled={props.busy}>
                <RotateCcw className="size-4" /> Reopen
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => props.onEdit("dismissed")}>
                  <CheckCircle2 className="size-4" /> Looks fine
                </Button>
                <Button size="sm" variant="ghost" onClick={() => props.onEdit("confirmed")}>
                  <AlertTriangle className="size-4" /> Confirm
                </Button>
                <Link href={`/events/${slug}/manage/results?exclude=${f.judgeId}`} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                  <UserX className="size-4" /> Exclude judge…
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
