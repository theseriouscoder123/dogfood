"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { send } from "@/lib/client";
import type { EventDetail, Prize, Question, QuestionType, Track } from "@/lib/types";
import { Button, Card, EmptyState, ErrorText, Field, inputClass, Pill, SuccessText } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { Avatar } from "@/components/visuals";

/** Runs an API call, shows its error, and refreshes server data on success. */
function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(method: string, path: string, body?: unknown): Promise<boolean> {
    setPending(true);
    const r = await send(method, path, body);
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }
  return { run, error, pending };
}

// ── details & branding ────────────────────────────────────────────────────────

export function DetailsForm({ slug, event }: { slug: string; event: EventDetail["event"] }) {
  const { run, error, pending } = useAction();
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    name: event.name,
    tagline: event.tagline,
    location: event.location,
    description: event.description,
    overview: event.overview,
    rules: event.rules,
    bannerUrl: event.bannerUrl,
    logoUrl: event.logoUrl,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF({ ...f, [k]: v });
    setSaved(false);
  };

  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("PATCH", `/api/events/${slug}`, f)) setSaved(true);
      }}
    >
      <Card title="Branding" description="The banner spans the top of your event page; the logo sits on top of it.">
        <div className="grid gap-5 md:grid-cols-[1fr_180px]">
          <Field label="Banner" hint="Wide image, about 1600×500.">
            <div className="mt-1.5">
              <ImageUpload value={f.bannerUrl} onChange={(u) => set("bannerUrl", u)} aspect="aspect-[16/5]" label="Upload banner" />
            </div>
          </Field>
          <Field label="Logo" hint="Square.">
            <div className="mt-1.5">
              <ImageUpload value={f.logoUrl} onChange={(u) => set("logoUrl", u)} aspect="aspect-square" label="Logo" hint="Square image" />
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Basics">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Event name" required>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} className={inputClass} />
          </Field>
          <Field label="Location">
            <input value={f.location} onChange={(e) => set("location", e.target.value)} maxLength={120} placeholder="Online" className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Tagline" hint="Shown under the event name.">
              <input value={f.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={160} placeholder="Build the platform that will judge you" className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Short summary" hint="Used on listing cards when there's no tagline.">
              <textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={500} className={inputClass} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Overview" description="The main story of your event: what to build, who it's for, what's special. Markdown supported.">
        <textarea
          value={f.overview}
          onChange={(e) => set("overview", e.target.value)}
          rows={12}
          maxLength={50000}
          className={`${inputClass} font-mono text-[13px] leading-6`}
          placeholder={"## What to build\n\n## Who should join\n\n## Judging"}
        />
      </Card>

      <Card title="Rules" description="Eligibility, code of conduct, IP, anything participants must agree to. Markdown supported.">
        <textarea value={f.rules} onChange={(e) => set("rules", e.target.value)} rows={10} maxLength={50000} className={`${inputClass} font-mono text-[13px] leading-6`} />
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
            <Check className="size-4" /> Saved
          </span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

// ── tracks ────────────────────────────────────────────────────────────────────

export function TracksEditor({ slug, tracks }: { slug: string; tracks: Track[] }) {
  const { run, error, pending } = useAction();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card title="Tracks" description="Themes participants choose from. Each project belongs to one track.">
        {tracks.length === 0 ? (
          <p className="text-sm text-muted">No tracks yet. Add the first one below.</p>
        ) : (
          <ul className="divide-y divide-line">
            {tracks.map((t) =>
              editing === t.id ? (
                <li key={t.id} className="py-3">
                  <form
                    className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      if (await run("PATCH", `/api/events/${slug}/tracks/${t.id}`, { name: fd.get("name"), description: fd.get("description") })) setEditing(null);
                    }}
                  >
                    <input name="name" defaultValue={t.name} required maxLength={80} className={`${inputClass} mt-0`} />
                    <input name="description" defaultValue={t.description} maxLength={2000} placeholder="Description" className={`${inputClass} mt-0`} />
                    <div className="flex gap-1">
                      <Button type="submit" size="md" disabled={pending}>
                        Save
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{t.name}</div>
                    <div className="truncate text-sm text-muted">{t.description || "No description"}</div>
                  </div>
                  <Pill>{t.projectCount ?? 0} projects</Pill>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(t.id)} aria-label={`Edit ${t.name}`}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => void run("DELETE", `/api/events/${slug}/tracks/${t.id}`)} aria-label={`Delete ${t.name}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
      <Card title="Add a track">
        <form
          className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            if (await run("POST", `/api/events/${slug}/tracks`, { name: fd.get("name"), description: fd.get("description") })) form.reset();
          }}
        >
          <input name="name" placeholder="Track name" required maxLength={80} className={`${inputClass} mt-0`} />
          <input name="description" placeholder="One line on the challenge (optional)" maxLength={2000} className={`${inputClass} mt-0`} />
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" /> Add
          </Button>
        </form>
      </Card>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

// ── prizes ────────────────────────────────────────────────────────────────────

function PrizeFields({ prize, tracks }: { prize?: Prize; tracks: Track[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-3">
        <Field label="Prize name" required>
          <input name="name" defaultValue={prize?.name} placeholder="Grand prize" required maxLength={120} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Value">
          <input name="value" defaultValue={prize?.value} placeholder="$1,000" maxLength={120} className={inputClass} />
        </Field>
      </div>
      <div>
        <Field label="Rank">
          <input name="rank" type="number" min={1} defaultValue={prize?.rank ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Track">
          <select name="trackId" defaultValue={prize?.trackId ?? ""} className={inputClass}>
            <option value="">Overall</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="sm:col-span-4">
        <Field label="Description">
          <input name="description" defaultValue={prize?.description} maxLength={2000} placeholder="What the winner gets" className={inputClass} />
        </Field>
      </div>
    </div>
  );
}

const prizeBody = (fd: FormData) => {
  const rank = String(fd.get("rank") ?? "");
  return { name: fd.get("name"), value: fd.get("value"), description: fd.get("description"), trackId: fd.get("trackId") || null, rank: rank ? Number(rank) : null };
};

export function PrizesEditor({ slug, prizes, tracks }: { slug: string; prizes: Prize[]; tracks: Track[] }) {
  const { run, error, pending } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const trackName = (id: string | null) => tracks.find((t) => t.id === id)?.name ?? "Overall";

  return (
    <div className="space-y-4">
      <Card title="Prizes" description="Values like “$500” are added up into the prize pool shown on your event page.">
        {prizes.length === 0 ? (
          <p className="text-sm text-muted">No prizes yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {prizes.map((p) =>
              editing === p.id ? (
                <li key={p.id} className="py-4">
                  <form
                    className="space-y-3"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run("PATCH", `/api/events/${slug}/prizes/${p.id}`, prizeBody(new FormData(e.currentTarget)))) setEditing(null);
                    }}
                  >
                    <PrizeFields prize={p} tracks={tracks} />
                    <div className="flex gap-2">
                      <Button type="submit" disabled={pending}>
                        Save prize
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-bold text-accent">{p.rank ?? "•"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {p.name} {p.value && <span className="font-display text-ink-2">· {p.value}</span>}
                    </div>
                    <div className="truncate text-sm text-muted">
                      {trackName(p.trackId)}
                      {p.description && ` · ${p.description}`}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p.id)} aria-label={`Edit ${p.name}`}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => void run("DELETE", `/api/events/${slug}/prizes/${p.id}`)} aria-label={`Delete ${p.name}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
      <Card title="Add a prize">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            if (await run("POST", `/api/events/${slug}/prizes`, prizeBody(new FormData(form)))) form.reset();
          }}
        >
          <PrizeFields tracks={tracks} />
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" /> Add prize
          </Button>
        </form>
      </Card>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

// ── submission questions ──────────────────────────────────────────────────────

const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short answer",
  long_text: "Paragraph",
  url: "Link",
  single_select: "Multiple choice",
  checkbox: "Checkbox (yes/no)",
};

function QuestionForm({ initial, onSubmit, onCancel, pending }: {
  initial?: Question;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
  onCancel?: () => void;
  pending: boolean;
}) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? "short_text");
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const ok = await onSubmit({
          label: fd.get("label"),
          help: fd.get("help"),
          type,
          options: String(fd.get("options") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
          required: fd.get("required") === "on",
          isPublic: fd.get("isPublic") !== "on",
        });
        if (ok && !initial) {
          form.reset();
          setType("short_text");
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <Field label="Question" required>
          <input name="label" defaultValue={initial?.label} required maxLength={200} placeholder="e.g. Which APIs did you use?" className={inputClass} />
        </Field>
        <Field label="Answer type">
          <select value={type} onChange={(e) => setType(e.target.value as QuestionType)} className={inputClass}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Help text">
        <input name="help" defaultValue={initial?.help} maxLength={1000} placeholder="Shown under the question (optional)" className={inputClass} />
      </Field>
      {type === "single_select" && (
        <Field label="Options" hint="One per line, at least two.">
          <textarea name="options" defaultValue={initial?.options.join("\n")} rows={4} className={inputClass} placeholder={"Idea\nPrototype\nLaunched"} />
        </Field>
      )}
      <div className="flex flex-wrap gap-5 text-sm font-medium">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="required" defaultChecked={initial?.required} className="size-4 accent-[var(--primary)]" /> Required to submit
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPublic" defaultChecked={initial ? !initial.isPublic : false} className="size-4 accent-[var(--primary)]" /> Private (organizers only)
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {initial ? "Save question" : (
            <>
              <Plus className="size-4" /> Add question
            </>
          )}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function QuestionsEditor({ slug, questions }: { slug: string; questions: Question[] }) {
  const { run, error, pending } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const move = (q: Question, dir: -1 | 1) => {
    const other = questions[questions.indexOf(q) + dir];
    if (!other) return;
    void (async () => {
      await run("PATCH", `/api/events/${slug}/questions/${q.id}`, { position: other.position });
      await run("PATCH", `/api/events/${slug}/questions/${other.id}`, { position: q.position });
    })();
  };

  return (
    <div className="space-y-4">
      <Card
        title="Your questions"
        description="Every project has a name, tagline, story, cover image, links, track and tech tags. Add your own questions on top."
      >
        {questions.length === 0 ? (
          <EmptyState title="No custom questions yet">Add questions like “Which sponsor APIs did you use?” or “I agree to the rules”.</EmptyState>
        ) : (
          <ol className="space-y-3">
            {questions.map((q, i) => (
              <li key={q.id} className="rounded-xl border border-line p-4">
                {editing === q.id ? (
                  <QuestionForm
                    initial={q}
                    pending={pending}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (b) => {
                      const ok = await run("PATCH", `/api/events/${slug}/questions/${q.id}`, b);
                      if (ok) setEditing(null);
                      return ok;
                    }}
                  />
                ) : (
                  <div className="flex items-start gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-bold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        {q.label}
                        {q.required && <span className="ml-0.5 text-danger">*</span>}
                      </div>
                      {q.help && <div className="text-sm text-muted">{q.help}</div>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Pill>{TYPE_LABELS[q.type]}</Pill>
                        {q.required && <Pill tone="primary">Required</Pill>}
                        {!q.isPublic && (
                          <Pill tone="warn">
                            <Lock className="size-3" /> Private
                          </Pill>
                        )}
                        {q.type === "single_select" && <span className="text-xs text-muted">{q.options.join(" · ")}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="sm" disabled={pending || i === 0} onClick={() => move(q, -1)} aria-label="Move up">
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={pending || i === questions.length - 1} onClick={() => move(q, 1)} aria-label="Move down">
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(q.id)} aria-label="Edit question">
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => confirm("Delete this question and all its answers?") && void run("DELETE", `/api/events/${slug}/questions/${q.id}`)}
                        aria-label="Delete question"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title="Add a question">
        <QuestionForm pending={pending} onSubmit={(b) => run("POST", `/api/events/${slug}/questions`, b)} />
      </Card>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

// ── organizers ────────────────────────────────────────────────────────────────

export function OrganizersEditor({ slug, organizers, meId }: { slug: string; organizers: Array<{ id: string; name: string; email: string }>; meId: string }) {
  const { run, error, pending } = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Card title="Organizers" description="Organizers can edit the event, see drafts, manage judging and export data.">
        <ul className="divide-y divide-line">
          {organizers.map((o) => (
            <li key={o.id} className="flex items-center gap-3 py-3">
              <Avatar name={o.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {o.name} {o.id === meId && <span className="text-xs font-medium text-muted">(you)</span>}
                </div>
                <div className="truncate text-sm text-muted">{o.email}</div>
              </div>
              <Button variant="ghost" size="sm" disabled={pending || organizers.length <= 1} onClick={() => void run("DELETE", `/api/events/${slug}/organizers/${o.id}`)} aria-label={`Remove ${o.name}`}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Add an organizer" description="People without an account can sign up later with this email to claim it.">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const email = String(new FormData(form).get("email"));
            if (await run("POST", `/api/events/${slug}/organizers`, { email })) {
              form.reset();
              setNotice(`${email} is now an organizer.`);
            }
          }}
        >
          <input name="email" type="email" placeholder="co-organizer@example.org" required className={`${inputClass} mt-0`} />
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" /> Add organizer
          </Button>
        </form>
        <div className="mt-3">
          <SuccessText>{notice}</SuccessText>
        </div>
      </Card>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
