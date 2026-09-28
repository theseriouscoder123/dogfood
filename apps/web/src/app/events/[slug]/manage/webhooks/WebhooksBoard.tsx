"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CheckCircle2, Clock, Pause, Play, Plus, ScrollText, Send, Trash2, Webhook, XCircle } from "lucide-react";
import { send } from "@/lib/client";
import type { WebhookList } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, EmptyState, Pill } from "@/components/ui";
import { useDialog, useToast } from "@/components/feedback";
import { NewWebhook } from "./NewWebhook";
import { FormatBadge } from "./formats";

export function WebhooksBoard({ slug, data }: { slug: string; data: WebhookList }) {
  const router = useRouter();
  const toast = useToast();
  const ask = useDialog();
  const [adding, setAdding] = useState(data.webhooks.length === 0);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/events/${slug}/webhooks`;

  async function act(id: string, label: string, method: string, path: string, body?: unknown) {
    setBusy(id + label);
    const r = await send(method, path, body);
    setBusy(null);
    if (!r.ok) return toast.error(r.message);
    toast.success(label);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Webhooks</h1>
          <p className="mt-1 text-sm text-muted">Send event activity to Slack, Discord or your own services.</p>
        </div>
        {!adding && data.webhooks.length < data.limits.maxWebhooks && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add endpoint
          </Button>
        )}
      </div>

      {adding && <NewWebhook slug={slug} eventTypes={data.eventTypes} onClose={data.webhooks.length ? () => setAdding(false) : undefined} />}

      {data.webhooks.length === 0 ? (
        !adding && <EmptyState icon={<Webhook className="size-5" />} title="No endpoints yet" />
      ) : (
        <ul className="space-y-3">
          {data.webhooks.map((w) => (
            <li key={w.id} className={`rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${w.active ? "border-line" : "border-danger/30"}`}>
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <FormatBadge format={w.format} />
                <div className="min-w-0 flex-1">
                  <Link href={`/events/${slug}/manage/webhooks/${w.id}`} className="block truncate font-mono text-[13px] font-semibold hover:text-primary">
                    {w.url}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    {w.description && <span className="text-ink-2">{w.description}</span>}
                    <span>{w.eventTypes.length === 0 ? "All events" : `${w.eventTypes.length} event type${w.eventTypes.length === 1 ? "" : "s"}`}</span>
                    {w.lastAttempt && (
                      <span>
                        Last: {w.lastAttempt.lastStatusCode ?? "no response"} · {formatDate(w.lastAttempt.lastAttemptAt)}
                      </span>
                    )}
                  </div>
                  {!w.active && <p className="mt-1.5 text-xs font-semibold text-danger">Paused{w.disabledReason ? `: ${w.disabledReason}` : ""}</p>}
                </div>
                <div className="flex items-center gap-3 text-sm font-semibold tabular-nums">
                  <span className="inline-flex items-center gap-1 text-success" title="Delivered, last 24 h">
                    <CheckCircle2 className="size-4" /> {w.last24h.succeeded}
                  </span>
                  <span className="inline-flex items-center gap-1 text-warn" title="Retrying">
                    <Clock className="size-4" /> {w.last24h.pending}
                  </span>
                  <span className="inline-flex items-center gap-1 text-danger" title="Failed">
                    <XCircle className="size-4" /> {w.last24h.failed}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                <Button size="sm" variant="secondary" disabled={!w.active || busy !== null} onClick={() => act(w.id, "Test sent", "POST", `${base}/${w.id}/ping`)}>
                  <Send className="size-3.5" /> Send test
                </Button>
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act(w.id, w.active ? "Paused" : "Resumed", "PATCH", `${base}/${w.id}`, { active: !w.active })}>
                  {w.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {w.active ? "Pause" : "Resume"}
                </Button>
                <Link href={`/events/${slug}/manage/webhooks/${w.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                  <ScrollText className="size-3.5" /> Delivery log
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-danger"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (await ask.confirm({ title: "Delete this endpoint?", body: w.url, confirmLabel: "Delete", danger: true })) void act(w.id, "Deleted", "DELETE", `${base}/${w.id}`);
                  }}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">
        Requests are signed (Standard Webhooks) and retried with backoff for about two days.{" "}
        <Link href="/developers#webhook-events" className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
          Payload reference <ArrowUpRight className="size-3" />
        </Link>
      </p>
      {data.webhooks.some((w) => w.rotatingUntil) && <Pill tone="warn">A secret rotation is in progress</Pill>}
    </div>
  );
}
