import { api } from "@/lib/api";
import type { VotingAdmin, VotingResultsPreview } from "@/lib/types";
import { VotingManager } from "./VotingManager";
import { VotingResults } from "./VotingResults";

export const metadata = { title: "Community voting" };

export default async function VotingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<VotingAdmin>(`/api/events/${encodeURIComponent(slug)}/voting/admin`);
  const preview = data.window === "closed" ? await api<VotingResultsPreview>(`/api/events/${encodeURIComponent(slug)}/voting/results/preview`).catch(() => null) : null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Community voting</h1>
        <p className="max-w-3xl text-sm text-muted">A community vote, separate from the judges&apos; ranking.</p>
      </div>
      <VotingResults slug={slug} window={data.window} preview={preview} />
      <VotingManager slug={slug} data={data} />
    </div>
  );
}
