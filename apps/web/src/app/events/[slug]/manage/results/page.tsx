import { api } from "@/lib/api";
import type { NormalizationState, ResultsView } from "@/lib/types";
import { ResultsWorkbench } from "./ResultsWorkbench";

export const metadata = { title: "Results" };

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ exclude?: string }> }) {
  const { slug } = await params;
  const { exclude } = await searchParams;
  const base = `/api/events/${encodeURIComponent(slug)}/normalization`;
  const state = await api<NormalizationState>(base);
  // Open on what the public sees if something is published; otherwise on a live preview.
  const initial = state.publishedRunId
    ? await api<ResultsView>(`${base}/runs/${state.publishedRunId}`)
    : await api<ResultsView>(`${base}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Results</h1>
        <p className="max-w-3xl text-sm text-muted">
          Every judge scores a little differently. Scores here are adjusted for each judge&apos;s leniency, estimated from the projects they share with other judges, so a
          project isn&apos;t helped or hurt by who happened to review it. Raw averages are shown alongside, so every adjustment is visible.
        </p>
      </div>
      {state.reviewsSubmitted === 0 ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">No reviews have been submitted yet. Results appear here as judges submit.</p>
      ) : (
        <ResultsWorkbench slug={slug} state={state} initial={initial} exclude={exclude} />
      )}
    </div>
  );
}
