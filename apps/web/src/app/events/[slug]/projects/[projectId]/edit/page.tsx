import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getEvent } from "@/lib/data";
import { getMe } from "@/lib/session";
import type { ProjectDetail } from "@/lib/types";
import { EmptyState } from "@/components/ui";
import { ProjectEditor } from "./ProjectEditor";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ slug: string; projectId: string }> }) {
  const { slug, projectId } = await params;
  const me = await getMe();
  if (!me.user) redirect(`/login?next=/events/${slug}/projects/${projectId}/edit`);

  const [detail, event] = await Promise.all([
    api<ProjectDetail>(`/api/events/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectId)}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    getEvent(slug),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <Link href={`/events/${slug}/team`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {event.event.name} · My team
      </Link>
      <h1 className="mb-6 mt-3 text-3xl font-extrabold">Edit your submission</h1>
      {detail.canEdit ? (
        <ProjectEditor
          slug={slug}
          project={detail.project}
          tracks={event.tracks}
          questions={event.questions}
          answers={Object.fromEntries(detail.answers.map((a) => [a.questionId, a.value]))}
          deadline={event.event.submissionsCloseAt}
        />
      ) : (
        <EmptyState icon={<Lock className="size-5" />} title="This project can't be edited">
          Either submissions are closed, or you&apos;re not on this team.
        </EmptyState>
      )}
    </div>
  );
}
