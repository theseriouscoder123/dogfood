import Link from "next/link";
import { redirect } from "next/navigation";
import { Gavel } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { PairwiseNext } from "@/lib/types";
import { EmptyState } from "@/components/ui";
import { CompareClient } from "./CompareClient";

export const metadata = { title: "Head to head" };

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getMe();
  if (!me.user) redirect(`/login?next=/events/${slug}/judging/compare`);
  const data = await api<PairwiseNext>(`/api/events/${encodeURIComponent(slug)}/judging/pairwise`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  });
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
      <Link href={`/events/${slug}/judging`} className="text-sm font-semibold text-muted hover:text-ink">
        ← Judging dashboard
      </Link>
      <h1 className="mt-3 text-3xl font-extrabold">Head to head</h1>
      <p className="mt-1 text-muted">Which of these two is the stronger project overall?</p>
      <div className="mt-6">
        {!data ? (
          <EmptyState icon={<Gavel className="size-5" />} title="You're not judging this event" />
        ) : !data.enabled ? (
          <EmptyState icon={<Gavel className="size-5" />} title="Head-to-head judging is off for this event" />
        ) : (
          <CompareClient slug={slug} initial={data} />
        )}
      </div>
    </div>
  );
}
