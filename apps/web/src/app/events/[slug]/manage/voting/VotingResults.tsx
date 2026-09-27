"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Heart, Lock, Send } from "lucide-react";
import { send } from "@/lib/client";
import type { VotingResultsPreview, VotingWindow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Card, ErrorText } from "@/components/ui";
import { PositionChart, positionVerdict } from "@/components/PositionChart";

export function VotingResults({ slug, window, preview }: { slug: string; window: VotingWindow; preview: VotingResultsPreview | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (window === "off") return null;
  if (window !== "closed" || !preview)
    return (
      <Card title="People's Choice results">
        <p className="flex items-start gap-2 text-sm text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" /> Sealed until voting closes, for you too. Once it closes, you&apos;ll preview the count here, review any incidents in Vote review,
          and then publish.
        </p>
      </Card>
    );

  async function act(path: "publish" | "unpublish") {
    setPending(true);
    const r = await send("POST", `/api/events/${slug}/voting/results/${path}`, {});
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    router.refresh();
  }
  const verdict = positionVerdict(preview.positionCheck);
  const top = Math.max(1, preview.ranking[0]?.votes ?? 1);

  return (
    <Card
      title="People's Choice results"
      description={
        preview.published
          ? `Public since ${formatDate(preview.publishedAt)}. Quarantine decisions are locked while results are public.`
          : "Voting has closed. Check the count, settle open incidents in Vote review, then publish."
      }
      actions={
        preview.published ? (
          <div className="flex shrink-0 gap-2">
            <Link href={`/events/${slug}/peoples-choice`} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-primary hover:bg-primary-soft">
              <Eye className="size-4" /> View
            </Link>
            <Button size="sm" variant="secondary" onClick={() => act("unpublish")} disabled={pending}>
              <EyeOff className="size-4" /> Unpublish
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => act("publish")} disabled={pending} className="shrink-0">
            <Send className="size-4" /> Publish results
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <p className="mb-4 text-sm text-muted">
        {preview.stats.voters} voters · {preview.stats.votes} votes · {preview.stats.quarantinedBallots} ballot{preview.stats.quarantinedBallots === 1 ? "" : "s"} set aside
      </p>
      <ol className="space-y-2">
        {preview.ranking.slice(0, 8).map((r) => (
          <li key={r.project.id} className="flex items-center gap-3 text-sm">
            <span className="w-6 text-right font-bold tabular-nums text-muted">{r.rank}</span>
            <span className="w-44 truncate font-semibold sm:w-60">{r.project.title}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(r.votes / top) * 100}%` }} />
            </div>
            <span className="inline-flex w-12 items-center justify-end gap-1 tabular-nums">
              <Heart className="size-3.5 text-accent" /> {r.votes}
            </span>
          </li>
        ))}
      </ol>
      {preview.ranking.length > 8 && <p className="mt-2 text-xs text-muted">and {preview.ranking.length - 8} more</p>}

      <div className="mt-6 border-t border-line pt-5">
        <p className="mb-3 text-sm font-semibold">Did list position matter?</p>
        <PositionChart check={preview.positionCheck} />
        <p className={`mt-3 text-sm ${verdict.tone === "warn" ? "text-warn" : verdict.tone === "success" ? "text-success" : "text-muted"}`}>{verdict.text}</p>
      </div>
      <p className="mt-5 break-all font-mono text-[11px] text-muted">Ballot file SHA-256: {preview.ballotsHash}</p>
    </Card>
  );
}
