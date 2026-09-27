import { api } from "@/lib/api";
import type { ModerationQueue } from "@/lib/types";
import { ModerationBoard } from "./ModerationBoard";

export const metadata = { title: "Comments" };

export default async function CommentsModerationPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { slug } = await params;
  const { filter = "reported" } = await searchParams;
  const f = ["reported", "hidden", "recent"].includes(filter) ? filter : "reported";
  const data = await api<ModerationQueue>(`/api/events/${encodeURIComponent(slug)}/comments/moderation?filter=${f}`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Comments</h1>
        <p className="max-w-3xl text-sm text-muted">
          Reported comments land here. Three reports from established accounts hide a comment automatically until you look at it. Hiding is reversible and needs a reason;
          everything is in the audit log.
        </p>
      </div>
      <ModerationBoard slug={slug} data={data} filter={f as "reported" | "hidden" | "recent"} />
    </div>
  );
}
