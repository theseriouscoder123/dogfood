"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, FileJson, Upload } from "lucide-react";
import { Button, Card, ErrorText, Field, inputClass } from "@/components/ui";

type Counts = Record<"people" | "newAccounts" | "tracks" | "prizes" | "criteria" | "questions" | "judges" | "teams" | "projects" | "conflicts" | "assignments" | "reviews", number>;
type Result = { dryRun: boolean; source: string; event: { id: string; slug: string; name: string }; counts: Counts };

const LABELS: Array<[keyof Counts, string]> = [
  ["projects", "projects"], ["teams", "teams"], ["people", "people"], ["newAccounts", "new accounts"], ["judges", "judges"], ["reviews", "reviews"],
  ["assignments", "assignments"], ["tracks", "tracks"], ["prizes", "prizes"], ["criteria", "rubric criteria"], ["questions", "questions"], ["conflicts", "conflicts of interest"],
];

export function ImportWizard() {
  const [file, setFile] = useState<{ name: string; data: unknown; slug: string } | null>(null);
  const [slug, setSlug] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);

  async function run(dryRun: boolean) {
    if (!file) return;
    setPending(true);
    setError(null);
    setProblems([]);
    const res = await fetch(`/api/events/import?dryRun=${dryRun}${slug ? `&slug=${encodeURIComponent(slug)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file.data),
    });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      if (body?.error?.code === "import_invalid") setProblems(body.error.details as string[]);
      else if (body?.error?.code === "invalid_request") setError(`The file doesn't match the format: ${(body.error.details as Array<{ path: unknown[]; message: string }>).slice(0, 3).map((d) => `${d.path.join(".")}: ${d.message}`).join("; ")}`);
      else setError(body?.error?.message ?? "Import failed.");
      setPreview(null);
      return;
    }
    if (dryRun) setPreview(body as Result);
    else setDone(body as Result);
  }

  async function pick(f: File | undefined) {
    setPreview(null);
    setProblems([]);
    setError(null);
    if (!f) return setFile(null);
    try {
      const data = JSON.parse(await f.text()) as { event?: { slug?: string; name?: string } };
      const s = data.event?.slug ?? (data.event?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      setFile({ name: f.name, data, slug: s });
      setSlug("");
    } catch {
      setError("That file isn't valid JSON.");
      setFile(null);
    }
  }

  if (done) {
    return (
      <Card>
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="size-10 text-success" />
          <h2 className="mt-3 text-xl font-bold">Imported “{done.event.name}”</h2>
          <p className="mt-1 text-sm text-muted">
            {done.counts.projects} projects, {done.counts.reviews} reviews and {done.counts.people} people are in. You&apos;re its organizer. Recompute results under Results when
            you&apos;re ready.
          </p>
          <Link href={`/events/${done.event.slug}/manage`} className="mt-5 inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover">
            Open the organizer console <ArrowRight className="size-4" />
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card title="1. Choose the file">
        <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-line-strong bg-surface-2/50 px-6 py-10 text-center transition hover:border-primary">
          {file ? <FileJson className="size-8 text-primary" /> : <Upload className="size-8 text-muted" />}
          <span className="mt-2 font-semibold">{file ? file.name : "Choose a .json file"}</span>
          <span className="text-xs text-muted">dogfood-event/v1 or DOGFOOD fixtures.json, up to 25 MB</span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {file && (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Slug for the new event" hint={`Leave empty to use “${file.slug}”.`}>
                <input className={`${inputClass} font-mono`} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder={file.slug} />
              </Field>
            </div>
            <Button onClick={() => run(true)} disabled={pending} variant="secondary">
              {pending && !preview ? "Checking…" : "Check the file"}
            </Button>
          </div>
        )}
        <div className="mt-4">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>

      {problems.length > 0 && (
        <section className="rounded-2xl border border-danger/30 bg-danger-soft p-5">
          <h2 className="flex items-center gap-2 font-bold text-danger">
            <AlertTriangle className="size-5" /> {problems.length} problem{problems.length === 1 ? "" : "s"}; nothing was imported
          </h2>
          <ul className="mt-3 max-h-72 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-ink-2">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {preview && (
        <Card title="2. What will be created" description={`A new event, “${preview.event.name}”, at /events/${preview.event.slug}. This preview ran the real import and then rolled it back.`}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {LABELS.map(([k, label]) => (
              <div key={k} className="rounded-xl border border-line bg-surface-2/60 p-3">
                <dd className="font-display text-xl font-extrabold tabular-nums">{preview.counts[k]}</dd>
                <dt className="text-xs text-muted">{label}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted">
            People already on this portal are matched by email and left as they are. New accounts have no password: people claim them by registering with the same email.
          </p>
          <Button className="mt-5" onClick={() => run(false)} disabled={pending}>
            {pending ? "Importing…" : "Import"}
          </Button>
        </Card>
      )}
    </div>
  );
}
