"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronLeft, ChevronRight, CloudOff, Loader2, Lock, Send, UserX } from "lucide-react";
import { send } from "@/lib/client";
import type { JudgeAssignment } from "@/lib/types";
import { Button, ErrorText, inputClass, Pill } from "@/components/ui";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function ScoringPanel({ slug, data }: { slug: string; data: JudgeAssignment }) {
  const router = useRouter();
  const { criteria, nav } = data;
  const base = `/api/events/${slug}/judging/${data.assignment.id}`;
  const [scores, setScores] = useState<Record<string, number>>(data.review?.scores ?? {});
  const [comment, setComment] = useState(data.review?.comment ?? "");
  const [status, setStatus] = useState(data.review?.status ?? "draft");
  // Start on the first criterion that still needs a score.
  const [focus, setFocus] = useState(() => Math.max(0, criteria.findIndex((c) => data.review?.scores[c.id] === undefined)));
  const [save, setSave] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(data.review?.updatedAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [recusing, setRecusing] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ scores, comment });
  latest.current = { scores, comment };

  const recused = data.assignment.status === "recused";
  const editable = data.judgingWindow === "open" && !recused && criteria.length > 0;
  const complete = criteria.every((c) => scores[c.id] !== undefined);
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0);
  const composite = useMemo(() => {
    if (!complete || !totalWeight) return null;
    const v = criteria.reduce((n, c) => n + c.weight * ((scores[c.id]! - c.minScore) / (c.maxScore - c.minScore)), 0) / totalWeight;
    return 1 + 4 * v;
  }, [complete, criteria, scores, totalWeight]);

  const persist = useCallback(async () => {
    setSave("saving");
    const r = await send<{ review: { updatedAt: string } }>("PUT", `${base}/review`, latest.current);
    if (!r.ok) {
      setSave("error");
      setError(r.message);
      return false;
    }
    setError(null);
    setSave("saved");
    setSavedAt(r.data.review.updatedAt);
    return true;
  }, [base]);

  const schedule = useCallback(() => {
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), 800);
  }, [persist]);

  const setScore = useCallback(
    (criterionId: string, value: number) => {
      if (!editable) return;
      setScores((s) => ({ ...s, [criterionId]: value }));
      schedule();
    },
    [editable, schedule],
  );

  // Keyboard scoring: digits score the focused criterion (0 = 10), ↑/↓ move between criteria.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocus((f) => Math.min(criteria.length - 1, f + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocus((f) => Math.max(0, f - 1));
      } else if (/^[0-9]$/.test(e.key)) {
        const c = criteria[focus];
        if (!c) return;
        const v = e.key === "0" ? 10 : Number(e.key);
        if (v >= c.minScore && v <= c.maxScore) {
          setScore(c.id, v);
          setFocus((f) => Math.min(criteria.length - 1, f + 1));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [criteria, focus, setScore]);

  // Flush a pending save before leaving the page.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save === "dirty" || save === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  async function submit() {
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    const saved = await persist();
    if (!saved) return setBusy(false);
    if (status !== "submitted") {
      const r = await send("POST", `${base}/submit`);
      if (!r.ok) {
        setBusy(false);
        return setError(r.message);
      }
      setStatus("submitted");
    }
    setBusy(false);
    if (nav.nextUnscoredId) router.push(`/events/${slug}/judging/${nav.nextUnscoredId}`);
    else router.push(`/events/${slug}/judging`);
    router.refresh();
  }

  const saveLabel: Record<SaveState, React.ReactNode> = {
    idle: savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not started",
    dirty: "Unsaved changes",
    saving: (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    ),
    saved: (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="size-3" /> Saved
      </span>
    ),
    error: (
      <span className="inline-flex items-center gap-1 text-danger">
        <CloudOff className="size-3" /> Not saved
      </span>
    ),
  };

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-lift">
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">Your review</span>
          {recused ? <Pill>Recused</Pill> : status === "submitted" ? <Pill tone="success">Submitted</Pill> : <Pill tone="warn">Draft</Pill>}
        </div>
        <span className="text-xs font-semibold text-muted">{saveLabel[save]}</span>
      </div>

      {!editable && (
        <p className="flex items-center gap-2 border-b border-line bg-surface-2 px-5 py-2.5 text-xs font-semibold text-muted">
          <Lock className="size-3.5" />
          {recused
            ? `You recused yourself: ${data.assignment.recusalReason}`
            : criteria.length === 0
              ? "The rubric isn't ready yet."
              : data.judgingWindow === "closed"
                ? "Judging has closed. This review is read-only."
                : "Judging hasn't opened yet."}
        </p>
      )}

      <div className="space-y-2 p-4">
        {criteria.map((c, i) => {
          const values = Array.from({ length: c.maxScore - c.minScore + 1 }, (_, k) => c.minScore + k);
          const active = focus === i;
          return (
            <div
              key={c.id}
              onClick={() => setFocus(i)}
              className={`rounded-xl border p-3 transition ${active && editable ? "border-primary/50 bg-primary-soft/50 ring-4 ring-primary/10" : "border-line"}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold">{c.label}</span>
                <span className="text-[11px] font-semibold text-muted">{totalWeight ? Math.round((c.weight / totalWeight) * 100) : 0}%</span>
              </div>
              {c.description && <p className="mt-0.5 text-xs text-muted">{c.description}</p>}
              {values.length <= 11 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={c.label}>
                  {values.map((v) => {
                    const on = scores[c.id] === v;
                    return (
                      <button
                        type="button"
                        key={v}
                        role="radio"
                        aria-checked={on}
                        disabled={!editable}
                        onClick={(e) => {
                          e.stopPropagation();
                          setScore(c.id, v);
                          setFocus(i);
                        }}
                        className={`grid size-9 place-items-center rounded-lg border text-sm font-bold transition disabled:cursor-not-allowed ${
                          on ? "border-primary bg-primary text-primary-ink shadow-card" : "border-line bg-surface text-ink-2 enabled:hover:border-primary/60 enabled:hover:text-primary"
                        }`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2.5 flex items-center gap-3">
                  <input
                    type="range"
                    min={c.minScore}
                    max={c.maxScore}
                    value={scores[c.id] ?? c.minScore}
                    disabled={!editable}
                    onChange={(e) => setScore(c.id, Number(e.target.value))}
                    className="flex-1 accent-[var(--primary)]"
                    aria-label={c.label}
                  />
                  <span className="w-10 text-right font-display text-lg font-bold">{scores[c.id] ?? "–"}</span>
                </div>
              )}
            </div>
          );
        })}

        <label className="block pt-2">
          <span className="text-xs font-bold">Comments</span>
          <textarea
            value={comment}
            disabled={!editable}
            onChange={(e) => {
              setComment(e.target.value);
              schedule();
            }}
            rows={4}
            maxLength={5000}
            placeholder="What stood out? What would make it better?"
            className={inputClass}
          />
        </label>
      </div>

      <div className="border-t border-line p-4">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-muted">
            {Object.keys(scores).length}/{criteria.length} scored
          </span>
          {composite !== null && (
            <span className="font-semibold">
              Weighted <span className="font-display text-lg font-extrabold">{composite.toFixed(2)}</span>
              <span className="text-muted"> / 5</span>
            </span>
          )}
        </div>
        {editable && (
          <Button variant={status === "submitted" ? "primary" : "accent"} size="lg" className="w-full" disabled={!complete || busy} onClick={() => void submit()}>
            {status === "submitted" ? (
              <>
                Save &amp; next <ArrowRight className="size-4" />
              </>
            ) : (
              <>
                <Send className="size-4" /> Submit {nav.nextUnscoredId ? "& next" : "review"}
              </>
            )}
          </Button>
        )}
        {editable && !complete && <p className="mt-2 text-center text-xs text-muted">Score every criterion to submit.</p>}
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          {nav.previousId ? (
            <Link href={`/events/${slug}/judging/${nav.previousId}`} className="inline-flex items-center gap-1 font-semibold text-muted hover:text-ink">
              <ChevronLeft className="size-4" /> Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs font-semibold text-muted">
            {nav.position} of {nav.total}
          </span>
          {nav.nextId ? (
            <Link href={`/events/${slug}/judging/${nav.nextId}`} className="inline-flex items-center gap-1 font-semibold text-muted hover:text-ink">
              Next <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </div>

        {editable && status !== "submitted" && !recusing && (
          <button type="button" onClick={() => setRecusing(true)} className="mt-4 inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-muted hover:text-danger">
            <UserX className="size-3.5" /> I can&apos;t judge this fairly
          </button>
        )}
        {recusing && (
          <form
            className="mt-4 space-y-3 rounded-xl border border-danger/25 bg-danger-soft p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              const r = await send("POST", `${base}/recuse`, { reason: f.get("reason"), declareConflict: f.get("conflict") === "on" });
              setBusy(false);
              if (!r.ok) return setError(r.message);
              router.push(`/events/${slug}/judging`);
              router.refresh();
            }}
          >
            <p className="text-sm font-bold text-danger">Recuse from this project</p>
            <textarea name="reason" required minLength={3} maxLength={500} rows={2} placeholder="Why? e.g. I know this team" className={inputClass} />
            <label className="flex items-start gap-2 text-xs font-medium text-ink-2">
              <input type="checkbox" name="conflict" className="mt-0.5 size-4 accent-[var(--primary)]" /> Declare a conflict of interest with this team (you won&apos;t be assigned any of its projects)
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" disabled={busy}>
                Recuse
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRecusing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
