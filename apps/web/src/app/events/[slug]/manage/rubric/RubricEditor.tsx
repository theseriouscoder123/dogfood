"use client";

import { useMemo, useState } from "react";
import { useDialog } from "@/components/feedback";
import { useRouter } from "next/navigation";
import { Lock, Plus, Sparkles, Trash2 } from "lucide-react";
import { send } from "@/lib/client";
import type { Criterion, Rubric } from "@/lib/types";
import { Button, Card, EmptyState, ErrorText, Field, inputClass } from "@/components/ui";

const TEMPLATE = [
  { label: "Functionality", description: "Does it work? How complete is it for a hackathon build?", weight: 30 },
  { label: "Technical depth", description: "How hard was the engineering, and how well was it done?", weight: 25 },
  { label: "Innovation", description: "Is the idea or approach new, or a fresh take on an old problem?", weight: 20 },
  { label: "Impact", description: "Would real people use this? How much would it help them?", weight: 15 },
  { label: "Presentation", description: "Can we understand it from the page, demo and README?", weight: 10 },
];

const smallInput = inputClass.replace("mt-1.5 w-full", "").replace("px-3.5 py-2.5", "px-2 py-1");

const BAR_COLORS = ["#3346f0", "#9b6bff", "#ff6b35", "#14b8a6", "#f59e0b", "#db2777", "#0284c7", "#16a34a"];

export function RubricEditor({ slug, rubric }: { slug: string; rubric: Rubric }) {
  const ask = useDialog();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries(rubric.criteria.map((c) => [c.id, c.weight])));
  const base = `/api/events/${slug}/criteria`;
  const { locked, criteria } = rubric;

  const total = useMemo(() => criteria.reduce((n, c) => n + (weights[c.id] ?? c.weight), 0), [criteria, weights]);
  // Slider range scales with the rubric, so weights of 1 and weights of 30 are both easy to adjust.
  const sliderMax = Math.max(10, Math.ceil(Math.max(0, ...criteria.map((c) => weights[c.id] ?? c.weight)) * 2.5));
  const pct = (c: Criterion) => (total ? ((weights[c.id] ?? c.weight) / total) * 100 : 0);

  async function run(fn: () => ReturnType<typeof send>) {
    setPending(true);
    const r = await fn();
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }

  async function applyTemplate() {
    setPending(true);
    for (const t of TEMPLATE) {
      const r = await send("POST", base, t);
      if (!r.ok) {
        setError(r.message);
        break;
      }
    }
    setPending(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {locked && (
        <div className="flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-bold">Judges have started scoring ({rubric.scoreCount} scores).</span> Criteria and score ranges are frozen so earlier scores keep
            their meaning. You can still rename criteria and change weights; weights are applied when results are computed.
          </p>
        </div>
      )}

      {criteria.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="No rubric yet"
          action={
            <Button onClick={() => void applyTemplate()} disabled={pending}>
              <Sparkles className="size-4" /> Start from a standard rubric
            </Button>
          }
        >
          Judges score every project on each criterion. Start from our five-criterion template, or add your own below.
        </EmptyState>
      ) : (
        <Card title="Weights" description="Each criterion's share of a project's score. Drag to rebalance; nothing needs to add up to 100.">
          {/* stacked share bar */}
          <div className="mb-6 flex h-3 overflow-hidden rounded-full bg-surface-2">
            {criteria.map((c, i) => (
              <div key={c.id} title={`${c.label}: ${pct(c).toFixed(0)}%`} style={{ width: `${pct(c)}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} className="transition-all" />
            ))}
          </div>
          <ul className="space-y-5">
            {criteria.map((c, i) => (
              <CriterionRow
                key={c.id}
                c={c}
                color={BAR_COLORS[i % BAR_COLORS.length]!}
                share={pct(c)}
                weight={weights[c.id] ?? c.weight}
                sliderMax={sliderMax}
                locked={locked}
                pending={pending}
                onWeight={(w) => setWeights({ ...weights, [c.id]: w })}
                onSave={(body) => run(() => send("PATCH", `${base}/${c.id}`, body))}
                onDelete={async () => (await ask.confirm({ title: `Delete “${c.label}”?`, confirmLabel: "Delete", danger: true })) && void run(() => send("DELETE", `${base}/${c.id}`))}
              />
            ))}
          </ul>
        </Card>
      )}

      {!locked && (
        <Card title="Add a criterion">
          <form
            className="grid gap-4 sm:grid-cols-6"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const ok = await run(() =>
                send("POST", base, {
                  label: f.get("label"),
                  description: f.get("description"),
                  weight: Number(f.get("weight")),
                  minScore: Number(f.get("minScore")),
                  maxScore: Number(f.get("maxScore")),
                }),
              );
              if (ok) form.reset();
            }}
          >
            <div className="sm:col-span-3">
              <Field label="Criterion" required>
                <input name="label" required maxLength={80} placeholder="e.g. Accessibility" className={inputClass} />
              </Field>
            </div>
            <Field label="Weight">
              <input name="weight" type="number" min={0.5} max={100} step={0.5} defaultValue={10} required className={inputClass} />
            </Field>
            <Field label="Min">
              <input name="minScore" type="number" min={0} max={99} defaultValue={1} required className={inputClass} />
            </Field>
            <Field label="Max">
              <input name="maxScore" type="number" min={1} max={100} defaultValue={5} required className={inputClass} />
            </Field>
            <div className="sm:col-span-6">
              <Field label="Guidance for judges" hint="What a high score means. Judges see this next to the slider.">
                <input name="description" maxLength={1000} className={inputClass} />
              </Field>
            </div>
            <div className="sm:col-span-6">
              <Button type="submit" disabled={pending}>
                <Plus className="size-4" /> Add criterion
              </Button>
            </div>
          </form>
        </Card>
      )}

      {criteria.length > 0 && (
        <Card title="What judges will see" description="A preview of the scoring form.">
          <div className="space-y-4">
            {criteria.map((c) => (
              <div key={c.id} className="rounded-xl border border-line p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{c.label}</span>
                  <span className="text-xs font-semibold text-muted">{pct(c).toFixed(0)}% of the score</span>
                </div>
                {c.description && <p className="mt-0.5 text-sm text-muted">{c.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Array.from({ length: Math.min(c.maxScore - c.minScore + 1, 11) }, (_, k) => c.minScore + k).map((v) => (
                    <span key={v} className="grid size-9 place-items-center rounded-lg border border-line text-sm font-semibold text-ink-2">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function CriterionRow({ c, color, share, weight, sliderMax, locked, pending, onWeight, onSave, onDelete }: {
  c: Criterion;
  color: string;
  share: number;
  weight: number;
  sliderMax: number;
  locked: boolean;
  pending: boolean;
  onWeight: (w: number) => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(c.label);
  const [description, setDescription] = useState(c.description);
  const [min, setMin] = useState(c.minScore);
  const [max, setMax] = useState(c.maxScore);
  const dirty = label !== c.label || description !== c.description || weight !== c.weight || min !== c.minScore || max !== c.maxScore;

  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-2.5 size-3 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1 space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} className={`${inputClass} mt-0 font-semibold`} aria-label="Criterion name" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="Guidance for judges" className={`${inputClass} mt-0`} aria-label="Guidance" />
        </div>
        <div className="w-24 text-right">
          <div className="font-display text-2xl font-extrabold">{share.toFixed(0)}%</div>
          <div className="text-xs text-muted">weight {weight}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 pl-6">
        <input
          type="range"
          min={0.5}
          max={sliderMax}
          step={0.5}
          value={weight}
          onChange={(e) => onWeight(Number(e.target.value))}
          className="min-w-40 flex-1"
          style={{ accentColor: color }}
          aria-label={`Weight of ${c.label}`}
        />
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
          Scale
          <input type="number" value={min} disabled={locked} onChange={(e) => setMin(Number(e.target.value))} className={`${smallInput} w-16 text-center`} aria-label="Minimum score" />
          to
          <input type="number" value={max} disabled={locked} onChange={(e) => setMax(Number(e.target.value))} className={`${smallInput} w-16 text-center`} aria-label="Maximum score" />
          {locked && <Lock className="size-3.5" />}
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={() =>
              void onSave({
                label,
                description,
                weight,
                ...(locked ? {} : { minScore: min, maxScore: max }),
              })
            }
          >
            Save
          </Button>
          {!locked && (
            <Button size="sm" variant="ghost" onClick={onDelete} disabled={pending} aria-label={`Delete ${c.label}`}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
