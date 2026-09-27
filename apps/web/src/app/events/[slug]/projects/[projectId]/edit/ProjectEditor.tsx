"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Eye, Lock, Send, Undo2, X } from "lucide-react";
import { send } from "@/lib/client";
import type { ProjectDetail, Question, Track } from "@/lib/types";
import { Button, Card, ErrorText, Field, inputClass, Pill, SuccessText } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { Countdown } from "@/components/Countdown";

type Project = ProjectDetail["project"];

export function ProjectEditor({ slug, project, tracks, questions, answers, deadline }: {
  slug: string;
  project: Project;
  tracks: Track[];
  questions: Question[];
  answers: Record<string, string>;
  deadline: string;
}) {
  const router = useRouter();
  const base = `/api/events/${slug}/projects/${project.id}`;
  const [f, setF] = useState({
    title: project.title,
    tagline: project.tagline,
    description: project.description,
    trackId: project.track?.id ?? "",
    repoUrl: project.repoUrl ?? "",
    demoUrl: project.demoUrl ?? "",
    videoUrl: project.videoUrl ?? "",
    thumbnailUrl: project.thumbnailUrl,
    techTags: project.techTags,
  });
  const [ans, setAns] = useState<Record<string, string>>(answers);
  const [tagDraft, setTagDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const checklist = useMemo(() => {
    const items: Array<[string, boolean]> = [
      ["Title", !!f.title.trim()],
      ["Tagline", !!f.tagline.trim()],
      ["Description", !!f.description.trim()],
      ["Repository link", !!f.repoUrl.trim()],
    ];
    if (tracks.length) items.push(["Track", !!f.trackId]);
    for (const q of questions.filter((q) => q.required)) items.push([q.label, q.type === "checkbox" ? ans[q.id] === "true" : !!(ans[q.id] ?? "").trim()]);
    return items;
  }, [f, ans, tracks.length, questions]);
  const ready = checklist.every(([, ok]) => ok);
  const doneCount = checklist.filter(([, ok]) => ok).length;

  const payload = () => ({
    ...f,
    trackId: f.trackId || null,
    answers: Object.fromEntries(questions.map((q) => [q.id, ans[q.id] ?? ""])),
  });

  async function run(steps: Array<() => ReturnType<typeof send>>, done: string) {
    setPending(true);
    setNotice(null);
    for (const step of steps) {
      const r = await step();
      if (!r.ok) {
        setPending(false);
        setError(r.message);
        return false;
      }
    }
    setPending(false);
    setError(null);
    setDirty(false);
    setNotice(done);
    router.refresh();
    return true;
  }

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase().replace(/,$/, "");
    if (t && !f.techTags.includes(t) && f.techTags.length < 20) set("techTags", [...f.techTags, t]);
    setTagDraft("");
  }

  const submitted = project.status === "submitted";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
      <form
        className="min-w-0 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run([() => send("PATCH", base, payload())], "All changes saved.");
        }}
      >
        <Card title="Basics" description="What judges and visitors see first.">
          <div className="space-y-5">
            <Field label="Project name" required>
              <input value={f.title} onChange={(e) => set("title", e.target.value)} required maxLength={120} className={inputClass} />
            </Field>
            <Field label="Tagline" required hint={`${f.tagline.length}/200 · one sentence on what it does`}>
              <input value={f.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={200} placeholder="Status pages that stay lit when everything else goes dark" className={inputClass} />
            </Field>
            {tracks.length > 0 && (
              <Field label="Track" required>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {tracks.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => set("trackId", t.id)}
                      className={`rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                        f.trackId === t.id ? "border-primary bg-primary-soft text-primary ring-4 ring-primary/10" : "border-line hover:border-line-strong"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </Card>

        <Card title="Cover image" description="Shown on the gallery card and at the top of your project page. 16:9 works best.">
          <ImageUpload value={f.thumbnailUrl} onChange={(url) => set("thumbnailUrl", url)} label="Upload a cover image" />
        </Card>

        <Card title="Story" description="What it does, how you built it, what you learned. Markdown is supported.">
          <textarea
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
            rows={14}
            maxLength={20000}
            placeholder={"## Inspiration\n\n## What it does\n\n## How we built it\n\n## Challenges\n\n## What's next"}
            className={`${inputClass} font-mono text-[13px] leading-6`}
          />
        </Card>

        <Card title="Links">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Repository" required>
              <input type="url" value={f.repoUrl} onChange={(e) => set("repoUrl", e.target.value)} placeholder="https://github.com/…" className={inputClass} />
            </Field>
            <Field label="Live demo">
              <input type="url" value={f.demoUrl} onChange={(e) => set("demoUrl", e.target.value)} placeholder="https://…" className={inputClass} />
            </Field>
            <Field label="Demo video">
              <input type="url" value={f.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="https://youtube.com/…" className={inputClass} />
            </Field>
          </div>
        </Card>

        <Card title="Built with" description="Languages, frameworks, APIs. Press Enter or comma to add.">
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface p-2 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15">
            {f.techTags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-md bg-primary-soft py-1 pl-2 pr-1 text-xs font-semibold text-primary">
                {t}
                <button type="button" onClick={() => set("techTags", f.techTags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="rounded p-0.5 hover:bg-primary/15">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value) : setTagDraft(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagDraft);
                } else if (e.key === "Backspace" && !tagDraft && f.techTags.length) set("techTags", f.techTags.slice(0, -1));
              }}
              onBlur={() => tagDraft && addTag(tagDraft)}
              placeholder={f.techTags.length ? "" : "e.g. typescript, postgres"}
              className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
            />
          </div>
        </Card>

        {questions.length > 0 && (
          <Card title="Organizer questions" description="Questions from the organizers of this hackathon.">
            <div className="space-y-5">
              {questions.map((q) => (
                <Field
                  key={q.id}
                  label={q.label}
                  required={q.required}
                  hint={
                    <>
                      {q.help}
                      {!q.isPublic && (
                        <span className="ml-1 inline-flex items-center gap-1">
                          <Lock className="size-3" /> Only organizers see this answer.
                        </span>
                      )}
                    </>
                  }
                >
                  {q.type === "long_text" ? (
                    <textarea value={ans[q.id] ?? ""} onChange={(e) => (setAns({ ...ans, [q.id]: e.target.value }), setDirty(true))} rows={4} className={inputClass} />
                  ) : q.type === "single_select" ? (
                    <select value={ans[q.id] ?? ""} onChange={(e) => (setAns({ ...ans, [q.id]: e.target.value }), setDirty(true))} className={inputClass}>
                      <option value="">Choose one…</option>
                      {q.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : q.type === "checkbox" ? (
                    <span className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={ans[q.id] === "true"}
                        onChange={(e) => (setAns({ ...ans, [q.id]: e.target.checked ? "true" : "false" }), setDirty(true))}
                        className="size-4 accent-[var(--primary)]"
                      />
                      Yes
                    </span>
                  ) : (
                    <input
                      type={q.type === "url" ? "url" : "text"}
                      value={ans[q.id] ?? ""}
                      maxLength={q.type === "short_text" ? 300 : undefined}
                      onChange={(e) => (setAns({ ...ans, [q.id]: e.target.value }), setDirty(true))}
                      className={inputClass}
                    />
                  )}
                </Field>
              ))}
            </div>
          </Card>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (confirm("Withdraw this project? It leaves the event for good and can't be restored.")) {
                void run([() => send("POST", `${base}/withdraw`)], "Withdrawn.").then((ok) => ok && router.push(`/events/${slug}/team`));
              }
            }}
          >
            Withdraw project
          </Button>
          <Button type="submit" variant="secondary" disabled={pending}>
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </form>

      {/* status rail */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Status</span>
            <Pill tone={submitted ? "success" : "warn"}>{submitted ? "Submitted" : "Draft"}</Pill>
          </div>
          <p className="mt-3 text-xs font-semibold text-muted">Deadline in</p>
          <div className="mt-1.5">
            <Countdown to={deadline} />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold">
              <span>Submission checklist</span>
              <span className="text-muted">
                {doneCount}/{checklist.length}
              </span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full transition-all ${ready ? "bg-success" : "bg-primary"}`} style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
            </div>
            <ul className="space-y-1.5">
              {checklist.map(([label, ok]) => (
                <li key={label} className={`flex items-center gap-2 text-sm ${ok ? "text-ink-2" : "text-muted"}`}>
                  {ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0" />}
                  <span className="truncate">{label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 space-y-2">
            {!submitted ? (
              <Button
                variant="accent"
                size="lg"
                className="w-full"
                disabled={pending || !ready}
                onClick={() => void run([() => send("PATCH", base, payload()), () => send("POST", `${base}/submit`)], "Submitted! You can keep editing until the deadline.")}
              >
                <Send className="size-4" /> Submit project
              </Button>
            ) : (
              <>
                <Button size="lg" className="w-full" disabled={pending || !dirty} onClick={() => void run([() => send("PATCH", base, payload())], "Your submission is updated.")}>
                  Update submission
                </Button>
                <Button variant="ghost" className="w-full" disabled={pending} onClick={() => void run([() => send("POST", `${base}/unsubmit`)], "Moved back to draft.")}>
                  <Undo2 className="size-4" /> Unsubmit
                </Button>
              </>
            )}
            <Link href={`/events/${slug}/projects/${project.id}`} className="flex items-center justify-center gap-1.5 py-1 text-sm font-semibold text-muted hover:text-ink">
              <Eye className="size-4" /> Preview project page
            </Link>
          </div>
          {!ready && !submitted && <p className="mt-2 text-center text-xs text-muted">Complete the checklist to submit.</p>}
        </div>
        <ErrorText>{error}</ErrorText>
        <SuccessText>{notice}</SuccessText>
      </aside>
    </div>
  );
}
