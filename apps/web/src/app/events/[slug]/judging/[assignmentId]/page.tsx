import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckSquare, ExternalLink, PlayCircle, Square } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { JudgeAssignment } from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import { buttonClass, Card, GithubIcon, Pill } from "@/components/ui";
import { AvatarStack, Cover } from "@/components/visuals";
import { ScoringPanel } from "./ScoringPanel";

export const metadata = { title: "Score project" };

export default async function ScorePage({ params }: { params: Promise<{ slug: string; assignmentId: string }> }) {
  const { slug, assignmentId } = await params;
  const me = await getMe();
  if (!me.user) redirect(`/login?next=/events/${slug}/judging/${assignmentId}`);
  const data = await api<JudgeAssignment>(`/api/events/${encodeURIComponent(slug)}/judging/${encodeURIComponent(assignmentId)}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const p = data.project;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <Link href={`/events/${slug}/judging`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> All my reviews
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <article className="min-w-0 space-y-5">
          <header>
            <div className="mb-2 flex flex-wrap gap-2">
              {p.track && <Pill tone="primary">{p.track}</Pill>}
              <span className="inline-flex items-center gap-2 text-sm text-muted">
                <AvatarStack names={p.team.members} size={22} /> {p.team.name}
              </span>
            </div>
            <h1 className="text-3xl font-extrabold sm:text-4xl">{p.title}</h1>
            {p.tagline && <p className="mt-1.5 text-lg text-muted">{p.tagline}</p>}
          </header>

          <Cover seed={p.id} src={p.thumbnailUrl} label={p.title} className="aspect-[16/8] w-full" />

          {(p.demoUrl || p.repoUrl || p.videoUrl) && (
            <div className="flex flex-wrap gap-2">
              {p.demoUrl && (
                <a href={p.demoUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
                  <ExternalLink className="size-4" /> Try it
                </a>
              )}
              {p.repoUrl && (
                <a href={p.repoUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
                  <GithubIcon /> Source
                </a>
              )}
              {p.videoUrl && (
                <a href={p.videoUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
                  <PlayCircle className="size-4" /> Demo video
                </a>
              )}
            </div>
          )}

          <Card title="Story">{p.description.trim() ? <Markdown>{p.description}</Markdown> : <p className="text-sm text-muted">No description provided.</p>}</Card>

          {p.techTags.length > 0 && (
            <Card title="Built with">
              <div className="flex flex-wrap gap-2">
                {p.techTags.map((t) => (
                  <span key={t} className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-sm font-semibold text-ink-2">
                    {t}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {p.answers.length > 0 && (
            <Card title="Answers to organizer questions">
              <dl className="divide-y divide-line">
                {p.answers.map((a) => (
                  <div key={a.label} className="grid gap-1 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4">
                    <dt className="text-sm font-semibold text-ink-2">{a.label}</dt>
                    <dd className="text-sm">
                      {a.type === "checkbox" ? (
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
        </article>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <ScoringPanel key={data.assignment.id} slug={slug} data={data} />
        </aside>
      </div>
    </div>
  );
}
