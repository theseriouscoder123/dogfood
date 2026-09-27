import { api } from "@/lib/api";
import type { Rubric } from "@/lib/types";
import { RubricEditor } from "./RubricEditor";

export default async function RubricPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rubric = await api<Rubric>(`/api/events/${encodeURIComponent(slug)}/rubric`);
  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">Judging rubric</h1>
      <p className="mb-6 text-sm text-muted">The criteria every judge scores, and how much each one counts.</p>
      <RubricEditor slug={slug} rubric={rubric} />
    </div>
  );
}
