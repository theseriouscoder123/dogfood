import { api } from "@/lib/api";
import type { VoteReview } from "@/lib/types";
import { VoteReviewBoard } from "./VoteReviewBoard";

export const metadata = { title: "Vote review" };

export default async function VoteReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<VoteReview>(`/api/events/${encodeURIComponent(slug)}/voting/review`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Vote review</h1>
        <p className="max-w-3xl text-sm text-muted">Possible ballot stuffing, ranked by how many independent signals agree.</p>
      </div>
      <VoteReviewBoard slug={slug} data={data} />
    </div>
  );
}
