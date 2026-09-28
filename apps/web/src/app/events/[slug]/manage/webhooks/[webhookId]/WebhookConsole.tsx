"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Clock, KeyRound, Pause, Pencil, Play, RefreshCw, Send, Trash2, XCircle } from "lucide-react";
import { send } from "@/lib/client";
import type { DeliveryStatus, WebhookDelivery, WebhookDeliveryDetail, WebhookDetail } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Card, ErrorText, Field, inputClass, Pill } from "@/components/ui";
import { SecretReveal } from "../SecretReveal";
import { EventTypePicker } from "../EventTypePicker";

type Props = {
  slug: string;
  detail: WebhookDetail;
  eventTypes: Array<{ type: string; description: string }>;
  filter: DeliveryStatus | null;
  counts: Record<DeliveryStatus, number>;
};

/** The database hands JSON back with its keys reordered; show the envelope the way it's documented. */
function envelopeOrder(payload: unknown) {
  if (!payload || typeof payload !== "object") return payload;
  const { id, type, timestamp, event, data, ...rest } = payload as Record<string, unknown>;
  return { id, type, timestamp, event, data, ...rest };
}

const STATUS = {
  succeeded: { label: "Delivered", icon: CheckCircle2, cls: "text-success" },
  pending: { label: "Retrying", icon: Clock, cls: "text-warn" },
  failed: { label: "Gave up", icon: XCircle, cls: "text-danger" },
} as const;

export function WebhookConsole({ slug, detail, eventTypes, filter, counts }: Props) {
  const router = useRouter();
  const w = detail.webhook;
  const base = `/api/events/${slug}/webhooks/${w.id}`;
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // While anything is in flight, keep the log fresh so retries show up as they happen.
  const live = detail.deliveries.some((d) => d.status === "pending");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [live, router]);

  async function act(key: string, method: string, path: string, body?: unknown) {
    setBusy(key);
    setError(null);
    const r = await send<{ secret?: string }>(method, path, body);
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return null;
    }
    router.refresh();
    return r.data;
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {w.active ? <Pill tone="success">Active</Pill> : <Pill tone="danger">Off</Pill>}
            <Pill>{w.eventTypes.length === 0 ? "all events" : `${w.eventTypes.length} event types`}</Pill>
            {w.rotatingUntil && <Pill tone="warn">old secret valid until {formatDate(w.rotatingUntil)}</Pill>}
          </div>
          <h1 className="mt-2 break-all font-mono text-xl font-bold sm:text-2xl">{w.url}</h1>
          {w.description && <p className="mt-1 text-sm text-muted">{w.description}</p>}
          {!w.active && w.disabledReason && <p className="mt-2 text-sm font-semibold text-danger">Switched off: {w.disabledReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!w.active || busy !== null} onClick={() => act("ping", "POST", `${base}/ping`)}>
            <Send className="size-3.5" /> {busy === "ping" ? "Sending…" : "Send test"}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act("toggle", "PATCH", base, { active: !w.active })}>
            {w.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {w.active ? "Switch off" : "Switch on"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing((e) => !e)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={async () => {
              if (!confirm("Rotate the signing secret? The old one keeps working for 24 hours so you can update your receiver.")) return;
              const d = await act("rotate", "POST", `${base}/rotate-secret`);
              if (d?.secret) setSecret(d.secret);
            }}
          >
            <KeyRound className="size-3.5" /> Rotate secret
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy !== null}
            onClick={async () => {
              if (!confirm("Delete this endpoint and its delivery log? Nothing more will be sent to it.")) return;
              const r = await send("DELETE", base);
              if (r.ok) router.push(`/events/${slug}/manage/webhooks`);
              else setError(r.message);
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>
      {secret && <SecretReveal title="New signing secret. Copy it now." secret={secret} note="Deliveries carry signatures from both secrets for the next 24 hours, then only this one." onDone={() => setSecret(null)} />}
      {editing && <EditWebhook slug={slug} detail={detail} eventTypes={eventTypes} onDone={() => setEditing(false)} />}

      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(STATUS) as DeliveryStatus[]).map((s) => {
          const S = STATUS[s];
          return (
            <div key={s} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${S.cls}`}>
                <S.icon className="size-4" /> {S.label}
              </div>
              <div className="mt-1 font-display text-2xl font-extrabold tabular-nums">{counts[s]}</div>
              <div className="text-xs text-muted">last 24 hours</div>
            </div>
          );
        })}
      </div>

      <Card
        title="Deliveries"
        description="Newest first. Open one to see the exact payload and every attempt."
        padded={false}
        actions={
          <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
            <RefreshCw className={`size-3.5 ${live ? "animate-spin [animation-duration:3s]" : ""}`} /> {live ? "Live" : "Refresh"}
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2 px-5 pb-4 sm:px-6">
          {[null, "succeeded", "pending", "failed"].map((f) => (
            <Link
              key={f ?? "all"}
              href={f ? `?status=${f}` : "?"}
              scroll={false}
              className={`rounded-full border px-3 py-1 text-[13px] font-semibold ${filter === f ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong"}`}
            >
              {f ? STATUS[f as DeliveryStatus].label : "All"}
            </Link>
          ))}
        </div>
        {detail.deliveries.length === 0 ? (
          <p className="border-t border-line px-5 py-8 text-center text-sm text-muted sm:px-6">Nothing here yet. Press “Send test” to try the endpoint.</p>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface-2 text-xs font-bold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-2.5 sm:px-6">Status</th>
                  <th className="px-3 py-2.5">Event</th>
                  <th className="px-3 py-2.5">Response</th>
                  <th className="px-3 py-2.5">Attempts</th>
                  <th className="px-3 py-2.5">When</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {detail.deliveries.map((d) => (
                  <DeliveryRow key={d.id} slug={slug} webhookId={w.id} d={d} canRedeliver={w.active} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function DeliveryRow({ slug, webhookId, d, canRedeliver }: { slug: string; webhookId: string; d: WebhookDelivery; canRedeliver: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<WebhookDeliveryDetail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const S = STATUS[d.status];
  const path = `/api/events/${slug}/webhooks/${webhookId}/deliveries/${d.id}`;

  async function toggle() {
    setOpen((o) => !o);
    if (!info) {
      const r = await send<WebhookDeliveryDetail>("GET", path);
      if (r.ok) setInfo(r.data);
    }
  }

  return (
    <Fragment>
      <tr className="cursor-pointer align-top hover:bg-surface-2" onClick={toggle}>
        <td className="px-5 py-3 sm:px-6">
          <span className={`inline-flex items-center gap-1.5 font-semibold ${S.cls}`}>
            <S.icon className="size-4" /> {S.label}
          </span>
        </td>
        <td className="px-3 py-3">
          <code className="font-mono text-[13px] font-semibold">{d.eventType}</code>
          <div className="font-mono text-[11px] text-muted">
            {d.messageId}
            {d.redeliveryOfId && " · redelivery"}
          </div>
        </td>
        <td className="px-3 py-3">
          {d.lastStatusCode !== null ? <Pill tone={d.lastStatusCode < 300 ? "success" : "danger"}>{d.lastStatusCode}</Pill> : d.attempts === 0 ? <span className="text-muted">queued</span> : <Pill tone="danger">no response</Pill>}
          {d.lastError && <div className="mt-1 max-w-56 text-xs text-muted">{d.lastError}</div>}
        </td>
        <td className="px-3 py-3 tabular-nums">{d.attempts}</td>
        <td className="px-3 py-3 text-xs text-muted">
          {formatDate(d.lastAttemptAt ?? d.createdAt)}
          {d.nextAttemptAt && d.attempts > 0 && <div className="text-warn">next try {formatDate(d.nextAttemptAt)}</div>}
        </td>
        <td className="pr-4 pt-3">
          <ChevronDown className={`size-4 text-muted transition ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-bg/50 px-5 py-4 sm:px-6">
            {!info ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Attempts</h4>
                  {info.attempts.length === 0 ? (
                    <p className="text-sm text-muted">Not attempted yet.</p>
                  ) : (
                    <ol className="space-y-2">
                      {info.attempts.map((a, i) => (
                        <li key={a.attemptedAt} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <b>#{i + 1}</b>
                            {a.statusCode !== null ? <Pill tone={a.statusCode < 300 ? "success" : "danger"}>{a.statusCode}</Pill> : <Pill tone="danger">no response</Pill>}
                            <span className="text-muted">{formatDate(a.attemptedAt)}</span>
                            <span className="text-muted">{a.durationMs} ms</span>
                          </div>
                          {a.error && <p className="mt-1 text-danger">{a.error}</p>}
                          {a.responseBody && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted">{a.responseBody}</pre>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {d.status !== "pending" && (
                    <div className="mt-3 flex items-center gap-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canRedeliver}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const r = await send("POST", `${path}/redeliver`);
                          setMsg(r.ok ? "Queued again, with the same message id." : r.message);
                          if (r.ok) router.refresh();
                        }}
                      >
                        <RefreshCw className="size-3.5" /> Redeliver
                      </Button>
                      {msg && <span className="text-xs text-muted">{msg}</span>}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Payload</h4>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-xs leading-relaxed text-bg">{JSON.stringify(envelopeOrder(info.delivery.payload), null, 2)}</pre>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function EditWebhook({ slug, detail, eventTypes, onDone }: { slug: string; detail: WebhookDetail; eventTypes: Props["eventTypes"]; onDone: () => void }) {
  const router = useRouter();
  const w = detail.webhook;
  const [url, setUrl] = useState(w.url);
  const [description, setDescription] = useState(w.description);
  const [types, setTypes] = useState(w.eventTypes);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("PATCH", `/api/events/${slug}/webhooks/${w.id}`, { url, description, eventTypes: types });
    if (!r.ok) return setError(r.message);
    router.refresh();
    onDone();
  }

  return (
    <Card title="Edit endpoint">
      <form onSubmit={save} className="space-y-5">
        <Field label="Payload URL" required>
          <input className={`${inputClass} font-mono`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </Field>
        <Field label="Description">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        <EventTypePicker eventTypes={eventTypes} value={types} onChange={setTypes} />
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit">Save</Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
