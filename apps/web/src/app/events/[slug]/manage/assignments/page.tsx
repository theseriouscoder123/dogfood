import { History } from "lucide-react";
import { api } from "@/lib/api";
import type { AssignmentsOverview, Batch } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Card } from "@/components/ui";
import { AutoAssign } from "./AutoAssign";
import { CoverageTable } from "./CoverageTable";

export default async function AssignmentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = encodeURIComponent(slug);
  const [overview, { batches }] = await Promise.all([
    api<AssignmentsOverview>(`/api/events/${s}/assignments`),
    api<{ batches: Batch[] }>(`/api/events/${s}/assignment-batches`),
  ]);
  const lastTarget = Number(batches.find((b) => typeof b.params.reviewsPerProject === "number")?.params.reviewsPerProject ?? 3);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Assignments</h1>
        <p className="text-sm text-muted">Who reviews what. Judges only ever see the projects assigned to them here.</p>
      </div>

      <AutoAssign slug={slug} submissionsClosed={overview.submissionsClosed} />
      <CoverageTable slug={slug} rows={overview.projects} target={lastTarget} canEdit={overview.submissionsClosed} />

      {batches.length > 0 && (
        <Card title="History">
          <ul className="divide-y divide-line text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <History className="size-4 text-muted" />
                <span className="font-semibold">{b.name}</span>
                <span className="text-muted">{b.assignments} assignments</span>
                {b.seed !== null && <span className="font-mono text-xs text-muted">seed {b.seed}</span>}
                <span className="font-mono text-xs text-muted">{b.algorithm}</span>
                <span className="ml-auto text-xs text-muted">
                  {b.createdBy?.name ?? "system"} · {formatDate(b.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
