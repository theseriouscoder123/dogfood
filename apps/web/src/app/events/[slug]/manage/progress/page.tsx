import { api } from "@/lib/api";
import type { JudgingProgress } from "@/lib/types";
import { ProgressBoard } from "./ProgressBoard";

export const metadata = { title: "Judging progress" };

export default async function ProgressPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<JudgingProgress>(`/api/events/${encodeURIComponent(slug)}/progress`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Judging progress</h1>
        <p className="text-sm text-muted">Who has finished, who is behind, and which projects are waiting.</p>
      </div>
      <ProgressBoard slug={slug} initial={data} />
    </div>
  );
}
