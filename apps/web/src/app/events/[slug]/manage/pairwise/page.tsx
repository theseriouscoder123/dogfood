import { api } from "@/lib/api";
import type { PairwiseReport } from "@/lib/types";
import { PairwiseBoard } from "./PairwiseBoard";

export const metadata = { title: "Head to head" };

export default async function PairwisePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<PairwiseReport>(`/api/events/${encodeURIComponent(slug)}/pairwise`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Head to head</h1>
        <p className="text-sm text-muted">Judges pick the stronger of two projects. A Bradley–Terry model ranks them, as a check on the rubric results.</p>
      </div>
      <PairwiseBoard slug={slug} data={data} />
    </div>
  );
}
