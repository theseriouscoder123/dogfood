import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckSquare, ExternalLink, Lock, Pencil, PlayCircle, Square } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getEvent } from "@/lib/data";
import type { CommentsResponse, ProjectDetail } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Markdown } from "@/components/Markdown";
import { CommentThread } from "@/components/CommentThread";
import { Avatar, Cover, LogoTile } from "@/components/visuals";
import { buttonClass, Card, GithubIcon, Pill } from "@/components/ui";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string; projectId: string }> }) {
  const { slug, projectId } = await params;
  const [detail, { event }, comments] = await Promise.all([
    api<ProjectDetail>(`/api/events/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectId)}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    getEvent(slug),
    // Drafts and duplicates have no discussion; the API says so with a 404/409.
    api<CommentsResponse>(`/api/events/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectId)}/comments`).catch(() => null),
  ]);
  const { project: p, canEdit, answers } = detail;
  const isGithub = p.repoUrl ? /github\.com/i.test(p.repoUrl) : false;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <Link href={`/events/${slug}/projects`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {event.name} gallery
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            {p.status !== "submitted" && <Pill tone="warn">{p.status === "draft" ? "Draft, only your team can see this" : p.status}</Pill>}
            {p.duplicateOf && <Pill tone="danger">Flagged as a duplicate</Pill>}
            {p.track && <Pill tone="primary">{p.track.name}</Pill>}
          </div>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">{p.title}</h1>
          {p.tagline && <p className="mt-2 max-w-3xl text-lg text-muted">{p.tagline}</p>}
        </div>
        {canEdit && (
          <Link href={`/events/${slug}/projects/${p.id}/edit`} className={buttonClass("secondary")}>
            <Pencil className="size-4" /> Edit project
          </Link>
        )}
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Cover seed={p.id} src={p.thumbnailUrl} label={p.title} className="aspect-[16/9] w-full shadow-card" />

          <Card title="Story">
            {p.description.trim() ? <Markdown>{p.description}</Markdown> : <p className="text-sm text-muted">The team hasn&apos;t written a description yet.</p>}
          </Card>

          {p.techTags.length > 0 && (
            <Card title="Built with">
              <div className="flex flex-wrap gap-2">
                {p.techTags.map((t) => (
                  <span key={t} className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink-2">
                    {t}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {answers.length > 0 && (
            <Card title="More about this project">
              <dl className="divide-y divide-line">
                {answers.map((a) => (
                  <div key={a.questionId} className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
                    <dt className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
                      {a.label}
                      {!a.isPublic && <Lock className="size-3.5 text-muted" aria-label="Visible to your team and organizers only" />}
                    </dt>
                    <dd className="text-sm text-ink">
                      {a.value === "" ? (
                        <span className="text-muted">Not answered</span>
                      ) : a.type === "checkbox" ? (
                        <span className="inline-flex items-center gap-1.5">
                          {a.value === "true" ? <CheckSquare className="size-4 text-success" /> : <Square className="size-4 text-muted" />}
                          {a.value === "true" ? "Yes" : "No"}
                        </span>
                      ) : a.type === "url" ? (
                        <a href={a.value} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary hover:underline">
                          {a.value}
                        </a>
                      ) : (
                        <span className="whitespace-pre-wrap">{a.value}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {comments && <CommentThread slug={slug} projectId={p.id} initial={comments} />}
        </div>

        <aside className="order-first space-y-4 lg:sticky lg:top-24 lg:order-none lg:self-start">
          {(p.demoUrl || p.repoUrl || p.videoUrl) && (
            <div className="space-y-2 rounded-2xl border border-line bg-surface p-4 shadow-card">
              {p.demoUrl && (
                <a href={p.demoUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md", "w-full")}>
                  <ExternalLink className="size-4" /> Try it out
                </a>
              )}
              {p.repoUrl && (
                <a href={p.repoUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "md", "w-full")}>
                  {isGithub ? <GithubIcon /> : <ExternalLink className="size-4" />} Source code
                </a>
              )}
              {p.videoUrl && (
                <a href={p.videoUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "md", "w-full")}>
                  <PlayCircle className="size-4" /> Watch the demo
                </a>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h3 className="text-sm font-bold">Team {p.team.name}</h3>
            <ul className="mt-3 space-y-3">
              {p.team.members.map((m, i) => (
                <li key={i}>
                  <Link href={`/u/${m.profile}`} className="group flex items-center gap-3">
                    <Avatar name={m.name} src={m.avatarUrl} size={34} />
                    <div>
                      <div className="text-sm font-semibold group-hover:text-primary">{m.name}</div>
                      <div className="text-xs capitalize text-muted">{m.role}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <Link href={`/events/${slug}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-line-strong">
            <LogoTile seed={event.slug} src={event.logoUrl} name={event.name} className="size-12 text-base" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-muted">Submitted to</div>
              <div className="truncate font-bold">{event.name}</div>
              {p.submittedAt && <div className="text-xs text-muted">{formatDate(p.submittedAt)}</div>}
            </div>
          </Link>
        </aside>
      </div>
    </div>
  );
}
