import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { VoteView } from "@/lib/types";
import { getMe } from "@/lib/session";
import { getEvent } from "@/lib/data";
import { VoteClient } from "./VoteClient";

export const metadata = { title: "Vote" };

export default async function VotePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ code?: string }> }) {
  const { slug } = await params;
  const { code } = await searchParams;
  const [data, me, detail] = await Promise.all([
    api<VoteView>(`/api/events/${encodeURIComponent(slug)}/vote`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    getMe(),
    getEvent(slug),
  ]);
  return <VoteClient slug={slug} data={data} loggedInEmail={me.user?.email ?? null} code={code ?? null} published={detail.event.votingPublished} />;
}
