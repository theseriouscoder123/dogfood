"use client";

// Host a hackathon, one step at a time. Nothing is saved until the last step; then the event is
// created as a draft, followed by its tracks, prizes and rubric. The half-filled wizard is kept in
// this browser so a reload doesn't lose it.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Gavel, Globe, MapPin, Plus, Trophy, X } from "lucide-react";
import { fromLocalInput, send, toLocalInput } from "@/lib/client";
import { Button, ErrorText, Field, inputClass } from "@/components/ui";
import { useToast } from "@/components/feedback";

type Prize = { name: string; value: string };
type Rubric = "standard" | "simple" | "later";
type Draft = {
  name: string;
  tagline: string;
  description: string;
  online: boolean;
  city: string;
  preset: Preset;
  start: string; // datetime-local, UTC
  registrationOpensAt: string;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  judgingOpensAt: string;
  judgingClosesAt: string;
  maxTeamSize: number;
  tracks: string[];
  prizes: Prize[];
  rubric: Rubric;
};

const PRESETS = {
  weekend: { label: "Weekend", detail: "48 hours of building", hackHours: 48, judgeDays: 5 },
  week: { label: "Week-long", detail: "7 days of building", hackHours: 7 * 24, judgeDays: 7 },
  month: { label: "Month-long", detail: "30 days of building", hackHours: 30 * 24, judgeDays: 14 },
  custom: { label: "Custom", detail: "Set every date yourself", hackHours: 0, judgeDays: 0 },
} as const;
type Preset = keyof typeof PRESETS;

const RUBRICS: Record<Rubric, { label: string; detail: string; criteria: Array<{ label: string; description: string; weight: number; minScore: number; maxScore: number }> }> = {
  standard: {
    label: "Standard",
    detail: "Impact, technical execution, design and presentation, scored 1–5.",
    criteria: [
      { label: "Impact", description: "Does it solve a real problem for real people?", weight: 30, minScore: 1, maxScore: 5 },
      { label: "Technical execution", description: "Does it work, and is it built well?", weight: 30, minScore: 1, maxScore: 5 },
      { label: "Design", description: "Is it pleasant and clear to use?", weight: 20, minScore: 1, maxScore: 5 },
      { label: "Presentation", description: "Is the demo and write-up clear?", weight: 20, minScore: 1, maxScore: 5 },
    ],
  },
  simple: {
    label: "Single score",
    detail: "One overall score from 1 to 10.",
    criteria: [{ label: "Overall", description: "Your overall assessment of the project.", weight: 100, minScore: 1, maxScore: 10 }],
  },
  later: { label: "Set up later", detail: "Build your own rubric in the organizer console.", criteria: [] },
};

const TRACK_IDEAS = ["AI tooling", "Climate", "Developer experience", "Health", "Education", "Open track"];
const STEPS = ["Basics", "Schedule", "Tracks & prizes", "Judging", "Review"] as const;
const STORE = "dogfood:create-wizard";
const HOUR = 3_600_000;

const iso = (d: Date) => toLocalInput(d.toISOString());
const plus = (v: string, hours: number) => (v ? iso(new Date(new Date(v + ":00Z").getTime() + hours * HOUR)) : "");

function nextSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7);
  d.setUTCHours(9, 0, 0, 0);
  return iso(d);
}

/** Two weeks before hacking starts, but never in the past (and never after the start). */
function registrationFor(start: string): string {
  if (!start) return "";
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const ideal = new Date(start + ":00Z").getTime() - 14 * 24 * HOUR;
  return iso(new Date(Math.min(Math.max(ideal, now.getTime()), new Date(start + ":00Z").getTime())));
}

function applyPreset(d: Draft, preset: Preset, start = d.start): Draft {
  if (preset === "custom") return { ...d, preset };
  const p = PRESETS[preset];
  const close = plus(start, p.hackHours);
  return {
    ...d,
    preset,
    start,
    registrationOpensAt: registrationFor(start),
    submissionsOpenAt: start,
    submissionsCloseAt: close,
    judgingOpensAt: close,
    judgingClosesAt: plus(close, p.judgeDays * 24),
  };
}

const blank = (): Draft =>
  applyPreset(
    {
      name: "", tagline: "", description: "", online: true, city: "", preset: "weekend", start: nextSaturday(),
      registrationOpensAt: "", submissionsOpenAt: "", submissionsCloseAt: "", judgingOpensAt: "", judgingClosesAt: "",
      maxTeamSize: 4, tracks: [], prizes: [{ name: "Grand prize", value: "" }], rubric: "standard",
    },
    "weekend",
  );

/** The same rules the server enforces, so problems show up before the last step. */
function scheduleProblems(d: Draft): string[] {
  const t = (v: string) => (v ? new Date(v + ":00Z").getTime() : null);
  const [reg, open, close, jOpen, jClose] = [t(d.registrationOpensAt), t(d.submissionsOpenAt), t(d.submissionsCloseAt), t(d.judgingOpensAt), t(d.judgingClosesAt)];
  const out: string[] = [];
  if (!open || !close) out.push("Set when submissions open and close.");
  if (reg && open && reg > open) out.push("Registration has to open before submissions do.");
  if (open && close && open >= close) out.push("The submission deadline has to be after submissions open.");
  if (jOpen && close && jOpen < close) out.push("Judging can't open before the submission deadline.");
  if (jOpen && jClose && jOpen >= jClose) out.push("Judging has to close after it opens.");
  if (!jOpen && jClose) out.push("Set when judging opens.");
  return out;
}

const fmt = (v: string) =>
  v ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(v + ":00Z")) + " UTC" : "Not set";

export function CreateWizard() {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Draft>(blank);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [trackInput, setTrackInput] = useState("");

  // Restore a half-filled wizard from this browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) setD({ ...blank(), ...(JSON.parse(saved) as Partial<Draft>) });
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(d));
    } catch {}
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setDate = (k: keyof Draft, v: string) => setD((x) => ({ ...x, [k]: v, preset: "custom" }));
  const problems = useMemo(() => scheduleProblems(d), [d]);

  const stepError = (i: number): string | null => {
    if (i === 0 && !d.name.trim()) return "Give your hackathon a name.";
    if (i === 0 && !d.online && !d.city.trim()) return "Where is it happening?";
    if (i === 1 && problems.length) return problems[0]!;
    if (i === 1 && (d.maxTeamSize < 1 || d.maxTeamSize > 50)) return "Team size must be between 1 and 50.";
    return null;
  };

  function next() {
    const e = stepError(step);
    setError(e);
    if (!e) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goTo(i: number) {
    for (let k = 0; k < i; k++) {
      const e = stepError(k);
      if (e) {
        setStep(k);
        return setError(e);
      }
    }
    setError(null);
    setStep(i);
  }

  function addTrack(name: string) {
    const n = name.trim();
    if (n && !d.tracks.some((t) => t.toLowerCase() === n.toLowerCase()) && d.tracks.length < 20) set("tracks", [...d.tracks, n]);
    setTrackInput("");
  }

  async function create() {
    setError(null);
    setBusy("Creating your hackathon…");
    const r = await send<{ event: { slug: string } }>("POST", "/api/events", {
      name: d.name.trim(),
      tagline: d.tagline.trim(),
      description: d.description.trim(),
      location: d.online ? "Online" : d.city.trim(),
      registrationOpensAt: fromLocalInput(d.registrationOpensAt),
      submissionsOpenAt: fromLocalInput(d.submissionsOpenAt),
      submissionsCloseAt: fromLocalInput(d.submissionsCloseAt),
      judgingOpensAt: fromLocalInput(d.judgingOpensAt),
      judgingClosesAt: fromLocalInput(d.judgingClosesAt),
      maxTeamSize: d.maxTeamSize,
    });
    if (!r.ok) {
      setBusy(null);
      return setError(r.message);
    }
    const slug = r.data.event.slug;
    const base = `/api/events/${slug}`;
    const failed: string[] = [];
    setBusy("Adding tracks and prizes…");
    for (const name of d.tracks) if (!(await send("POST", `${base}/tracks`, { name })).ok) failed.push(`track “${name}”`);
    const prizes = d.prizes.filter((p) => p.name.trim());
    for (const [i, p] of prizes.entries()) if (!(await send("POST", `${base}/prizes`, { name: p.name.trim(), value: p.value.trim(), rank: i + 1 })).ok) failed.push(`prize “${p.name}”`);
    setBusy("Setting up judging…");
    for (const [i, c] of RUBRICS[d.rubric].criteria.entries()) if (!(await send("POST", `${base}/criteria`, { ...c, position: i })).ok) failed.push(`criterion “${c.label}”`);
    try {
      localStorage.removeItem(STORE);
    } catch {}
    if (failed.length) toast.error(`Created, but couldn't add ${failed.join(", ")}. Add them in the console.`);
    else toast.success("Draft created. Publish it when you're ready.");
    router.push(`/events/${slug}/manage`);
  }

  return (
    <div>
      {/* stepper */}
      <ol className="mb-8 flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <li key={label} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(i)}
              disabled={!!busy}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full p-1.5 sm:pr-3.5 text-sm font-semibold transition ${i === step ? "bg-primary-soft pr-3.5 text-primary" : i < step ? "text-ink hover:bg-surface-2" : "text-muted hover:bg-surface-2"}`}
            >
              <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${i < step ? "bg-primary text-primary-ink" : i === step ? "bg-primary text-primary-ink" : "bg-surface-2 text-muted"}`}>
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={i === step ? "" : "hidden sm:inline"}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-line-strong sm:w-6" />}
          </li>
        ))}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step === STEPS.length - 1) void create();
          else next();
        }}
        className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8"
      >
        {step === 0 && (
          <div className="space-y-5">
            <StepHead title="What's it called?" />
            <Field label="Hackathon name" required>
              <input autoFocus value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={120} placeholder="Raptors Autumn Jam" className={inputClass} />
            </Field>
            <Field label="Tagline">
              <input value={d.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={160} placeholder="72 hours to build something real" className={inputClass} />
            </Field>
            <Field label="Short description" hint={`${d.description.length}/500`}>
              <textarea value={d.description} onChange={(e) => set("description", e.target.value)} maxLength={500} rows={3} placeholder="Who it's for and what you hope people build." className={inputClass} />
            </Field>
            <div>
              <p className="text-sm font-semibold">Where</p>
              <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                <Choice active={d.online} onClick={() => set("online", true)} icon={<Globe className="size-5" />} title="Online" detail="Anyone, anywhere" />
                <Choice active={!d.online} onClick={() => set("online", false)} icon={<MapPin className="size-5" />} title="In person" detail="A venue or city" />
              </div>
              {!d.online && <input value={d.city} onChange={(e) => set("city", e.target.value)} maxLength={120} placeholder="Pune, India" className={`${inputClass} mt-3`} />}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <StepHead title="When is it?" sub="All times are UTC." />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.keys(PRESETS) as Preset[]).map((k) => (
                <Choice key={k} active={d.preset === k} onClick={() => setD((x) => applyPreset(x, k))} title={PRESETS[k].label} detail={PRESETS[k].detail} />
              ))}
            </div>
            {d.preset !== "custom" && (
              <Field label="Hacking starts">
                <input type="datetime-local" value={d.start} onChange={(e) => setD((x) => applyPreset(x, x.preset, e.target.value))} className={inputClass} />
              </Field>
            )}
            <ol className="space-y-3 rounded-xl border border-line p-4">
              {(
                [
                  ["registrationOpensAt", "Registration opens"],
                  ["submissionsOpenAt", "Submissions open"],
                  ["submissionsCloseAt", "Submission deadline"],
                  ["judgingOpensAt", "Judging opens"],
                  ["judgingClosesAt", "Judging closes"],
                ] as const
              ).map(([k, label], i) => (
                <li key={k} className="grid items-center gap-2 sm:grid-cols-[24px_1fr_240px]">
                  <span className="hidden size-6 place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary sm:grid">{i + 1}</span>
                  <span className="text-sm font-semibold">{label}</span>
                  <input type="datetime-local" value={d[k]} onChange={(e) => setDate(k, e.target.value)} className={`${inputClass} mt-0`} />
                </li>
              ))}
            </ol>
            {problems.length > 0 && (
              <ul className="space-y-1 text-sm text-danger">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="max-w-xs">
              <Field label="Maximum team size" hint="Solo entries are always allowed.">
                <input type="number" min={1} max={50} value={d.maxTeamSize} onChange={(e) => set("maxTeamSize", Number(e.target.value))} className={inputClass} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8">
            <div className="space-y-3">
              <StepHead title="Tracks" sub="Optional. Participants pick one when they submit." />
              <div className="flex gap-2">
                <input
                  value={trackInput}
                  onChange={(e) => setTrackInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTrack(trackInput);
                    }
                  }}
                  maxLength={80}
                  placeholder="Add a track"
                  className={`${inputClass} mt-0`}
                />
                <Button type="button" variant="secondary" onClick={() => addTrack(trackInput)} disabled={!trackInput.trim()}>
                  <Plus className="size-4" /> Add
                </Button>
              </div>
              {d.tracks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {d.tracks.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1.5 text-sm font-semibold">
                      {t}
                      <button type="button" aria-label={`Remove ${t}`} onClick={() => set("tracks", d.tracks.filter((x) => x !== t))} className="rounded-full p-0.5 text-muted hover:bg-surface hover:text-ink">
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {TRACK_IDEAS.filter((t) => !d.tracks.includes(t)).map((t) => (
                  <button key={t} type="button" onClick={() => addTrack(t)} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs font-semibold text-muted hover:border-primary hover:text-primary">
                    + {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <StepHead title="Prizes" sub="Optional. You can add details and link prizes to tracks later." />
              {d.prizes.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Trophy className="size-4 shrink-0 text-accent" />
                  <input value={p.name} onChange={(e) => set("prizes", d.prizes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={120} placeholder="Prize name" className={`${inputClass} mt-0`} />
                  <input value={p.value} onChange={(e) => set("prizes", d.prizes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} maxLength={120} placeholder="$1,000" className={`${inputClass} mt-0 w-32 shrink-0`} />
                  <button type="button" aria-label="Remove prize" onClick={() => set("prizes", d.prizes.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              {d.prizes.length < 20 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => set("prizes", [...d.prizes, { name: "", value: "" }])}>
                  <Plus className="size-4" /> Add a prize
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <StepHead title="How will projects be judged?" sub="You can edit the rubric until the first score comes in." />
            <div className="grid gap-3">
              {(Object.keys(RUBRICS) as Rubric[]).map((k) => (
                <Choice key={k} active={d.rubric === k} onClick={() => set("rubric", k)} icon={<Gavel className="size-5" />} title={RUBRICS[k].label} detail={RUBRICS[k].detail} />
              ))}
            </div>
            {RUBRICS[d.rubric].criteria.length > 0 && (
              <table className="w-full text-sm">
                <tbody>
                  {RUBRICS[d.rubric].criteria.map((c) => (
                    <tr key={c.label} className="border-t border-line">
                      <td className="py-2 font-semibold">{c.label}</td>
                      <td className="py-2 text-muted">{c.description}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{c.weight}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <StepHead title="Ready to create" sub="It's saved as a private draft. Only you can see it until you publish." />
            <dl className="divide-y divide-line rounded-xl border border-line">
              <Row label="Name" onEdit={() => goTo(0)}>
                <span className="font-semibold">{d.name}</span>
                {d.tagline && <span className="block text-muted">{d.tagline}</span>}
              </Row>
              <Row label="Where" onEdit={() => goTo(0)}>{d.online ? "Online" : d.city}</Row>
              <Row label="Submissions" onEdit={() => goTo(1)}>
                {fmt(d.submissionsOpenAt)} → {fmt(d.submissionsCloseAt)}
              </Row>
              <Row label="Judging" onEdit={() => goTo(1)}>
                {d.judgingOpensAt ? `${fmt(d.judgingOpensAt)} → ${fmt(d.judgingClosesAt)}` : "Not scheduled"}
              </Row>
              <Row label="Teams" onEdit={() => goTo(1)}>Up to {d.maxTeamSize}</Row>
              <Row label="Tracks" onEdit={() => goTo(2)}>{d.tracks.length ? d.tracks.join(", ") : "None"}</Row>
              <Row label="Prizes" onEdit={() => goTo(2)}>
                {d.prizes.filter((p) => p.name.trim()).length
                  ? d.prizes.filter((p) => p.name.trim()).map((p) => (p.value ? `${p.name} (${p.value})` : p.name)).join(", ")
                  : "None"}
              </Row>
              <Row label="Rubric" onEdit={() => goTo(3)}>{RUBRICS[d.rubric].label}</Row>
            </dl>
          </div>
        )}

        <ErrorText>{error}</ErrorText>
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
          {step > 0 ? (
            <Button type="button" variant="ghost" disabled={!!busy} onClick={() => (setError(null), setStep((s) => s - 1))}>
              <ArrowLeft className="size-4" /> Back
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" size="lg" disabled={!!busy}>
            {busy ?? (step === STEPS.length - 1 ? "Create hackathon" : "Continue")}
            {!busy && step < STEPS.length - 1 && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function StepHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold">{title}</h2>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

function Choice({ active, onClick, icon, title, detail }: { active: boolean; onClick: () => void; icon?: React.ReactNode; title: string; detail: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${active ? "border-primary bg-primary-soft/60 ring-2 ring-primary/20" : "border-line hover:border-line-strong"}`}
    >
      {icon && <span className={active ? "text-primary" : "text-muted"}>{icon}</span>}
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </button>
  );
}

function Row({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="grid grid-cols-[110px_1fr_auto] items-start gap-3 px-4 py-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
      <button type="button" onClick={onEdit} className="text-xs font-semibold text-primary hover:underline">
        Edit
      </button>
    </div>
  );
}
