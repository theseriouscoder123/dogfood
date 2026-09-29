"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Equal, Lock } from "lucide-react";
import { send } from "@/lib/client";
import type { PairCard, PairwiseNext } from "@/lib/types";
import { buttonClass, EmptyState } from "@/components/ui";
import { Cover } from "@/components/visuals";
import { useToast } from "@/components/feedback";

type Outcome = "left" | "right" | "tie";

export function CompareClient({ slug, initial }: { slug: string; initial: PairwiseNext }) {
  const toast = useToast();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<Outcome | null>(null);
  const base = `/api/events/${slug}/judging/pairwise`;
  const open = data.judgingWindow === "open";

  const decide = useCallback(
    async (outcome: Outcome) => {
      if (!data.pair || busy || !open) return;
      setBusy(outcome);
      const r = await send("POST", base, { leftId: data.pair.left.id, rightId: data.pair.right.id, outcome });
      if (!r.ok) {
        setBusy(null);
        return toast.error(r.message);
      }
      const next = await send<PairwiseNext>("GET", base);
      setBusy(null);
      if (next.ok) setData(next.data);
    },
    [data.pair, busy, open, base, toast],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "ArrowLeft") void decide("left");
      else if (e.key === "ArrowRight") void decide("right");
      else if (e.key === "ArrowDown" || e.key === "=") void decide("tie");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide]);

  const pct = data.suggested ? Math.min(100, Math.round((data.done / data.suggested) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-2 max-w-xs flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm font-semibold text-muted">
          {data.done} of {data.suggested} suggested
          {data.done >= data.suggested && data.pair && " · keep going if you like"}
        </p>
      </div>

      {!open && (
        <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm font-medium text-muted">
          <Lock className="size-4" /> {data.judgingWindow === "closed" ? "Judging has closed." : "Judging hasn't opened yet."}
        </p>
      )}

      {!data.pair ? (
        <EmptyState icon={<CheckCircle2 className="size-5" />} title={data.available < 1 ? "You need at least two projects to compare" : "You've compared every pair"}>
          {data.available >= 1 && "Thank you. Your rubric reviews are still where they were."}
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Side card={data.pair.left} slug={slug} />
            <Side card={data.pair.right} slug={slug} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <button type="button" disabled={!open || !!busy} onClick={() => decide("left")} className={buttonClass("primary", "lg")}>
              <ArrowLeft className="size-4" /> {busy === "left" ? "Saving…" : `${data.pair.left.title} is stronger`}
            </button>
            <button type="button" disabled={!open || !!busy} onClick={() => decide("tie")} className={buttonClass("secondary", "lg")}>
              <Equal className="size-4" /> {busy === "tie" ? "Saving…" : "Too close to call"}
            </button>
            <button type="button" disabled={!open || !!busy} onClick={() => decide("right")} className={buttonClass("primary", "lg")}>
              {busy === "right" ? "Saving…" : `${data.pair.right.title} is stronger`} <ArrowRight className="size-4" />
            </button>
          </div>
          <p className="text-center text-xs text-muted">Keyboard: ← left · ↓ too close · → right</p>
        </>
      )}
    </div>
  );
}

function Side({ card, slug }: { card: PairCard; slug: string }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <Cover seed={card.id} src={card.thumbnailUrl} label={card.title} rounded="rounded-none" className="aspect-[16/9] w-full" />
      <div className="flex flex-1 flex-col p-5">
        <h2 className="text-xl font-bold">{card.title}</h2>
        {card.tagline && <p className="mt-1 text-sm text-muted">{card.tagline}</p>}
        <p className="mt-3 text-xs text-muted">
          {card.team}
          {card.track && ` · ${card.track}`}
        </p>
        <Link href={`/events/${slug}/projects/${card.id}`} target="_blank" className="mt-4 inline-flex items-center gap-1 self-start text-sm font-semibold text-primary hover:underline">
          Open project <ExternalLink className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
