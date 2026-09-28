import { Download } from "lucide-react";
import { api } from "@/lib/api";
import type { IntegrityReport } from "@/lib/types";
import { buttonClass } from "@/components/ui";
import { IntegrityBoard } from "./IntegrityBoard";

export const metadata = { title: "Review integrity" };

export default async function IntegrityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<IntegrityReport>(`/api/events/${encodeURIComponent(slug)}/integrity`);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold">Review integrity</h1>
          <p className="max-w-3xl text-sm text-muted">Reviews worth a second look.</p>
        </div>
        {data.summary.reviewsChecked > 0 && (
          <a href={`/api/events/${encodeURIComponent(slug)}/normalization/report.md`} download className={buttonClass("secondary", "sm")}>
            <Download className="size-4" /> Proof report
          </a>
        )}
      </div>
      {data.summary.reviewsChecked === 0 ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">No reviews have been submitted yet. Checks run as soon as they are.</p>
      ) : (
        <IntegrityBoard slug={slug} data={data} />
      )}
    </div>
  );
}
