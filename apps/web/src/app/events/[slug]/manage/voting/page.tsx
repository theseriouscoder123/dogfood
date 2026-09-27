import { api } from "@/lib/api";
import type { VotingAdmin } from "@/lib/types";
import { VotingManager } from "./VotingManager";

export const metadata = { title: "Community voting" };

export default async function VotingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<VotingAdmin>(`/api/events/${encodeURIComponent(slug)}/voting/admin`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Community voting</h1>
        <p className="max-w-3xl text-sm text-muted">
          A People&apos;s Choice vote, separate from the judges&apos; ranking. Each voter gets a fixed number of votes and sees the projects in their own random order. Counts stay
          sealed until voting closes, for you too.
        </p>
      </div>
      <VotingManager slug={slug} data={data} />
    </div>
  );
}
