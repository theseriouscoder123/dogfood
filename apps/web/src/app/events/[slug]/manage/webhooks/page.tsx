import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, PauseCircle, ShieldCheck, Webhook, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { WebhookList } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Card, EmptyState, Pill } from "@/components/ui";
import { NewWebhook } from "./NewWebhook";

export const metadata = { title: "Webhooks" };

const hours = (ms: number) => (ms < 3_600_000 ? `${ms / 60_000} min` : `${ms / 3_600_000} h`);

export default async function WebhooksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<WebhookList>(`/api/events/${encodeURIComponent(slug)}/webhooks`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Webhooks</h1>
        <p className="max-w-3xl text-sm text-muted">
          Tell your own systems when things happen: post new submissions to your team chat, sync projects to a CRM, kick off a build when results go out. Every request is signed,
          retried if your endpoint is down, and logged here.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {data.webhooks.length === 0 ? (
            <EmptyState icon={<Webhook className="size-5" />} title="No endpoints yet">
              Add one below. You&apos;ll get a signing secret, and a test delivery to check the connection.
            </EmptyState>
          ) : (
            <Card title="Endpoints" description={`${data.webhooks.length} of ${data.limits.maxWebhooks}. Counts cover the last 24 hours.`} padded={false}>
              <ul className="divide-y divide-line border-t border-line">
                {data.webhooks.map((w) => (
                  <li key={w.id}>
                    <Link href={`/events/${slug}/manage/webhooks/${w.id}`} className="group flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 transition hover:bg-surface-2 sm:px-6">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${w.active ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}>
                        {w.active ? <Webhook className="size-4" /> : <PauseCircle className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[13px] font-semibold group-hover:text-primary">{w.url}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          {w.description && <span className="text-ink-2">{w.description}</span>}
                          <span>{w.eventTypes.length === 0 ? "all events" : `${w.eventTypes.length} event type${w.eventTypes.length === 1 ? "" : "s"}`}</span>
                          {w.lastAttempt && (
                            <span>
                              last {w.lastAttempt.lastStatusCode ?? "no response"} · {formatDate(w.lastAttempt.lastAttemptAt)}
                            </span>
                          )}
                        </div>
                        {!w.active && <p className="mt-1 text-xs font-semibold text-danger">Off{w.disabledReason ? `: ${w.disabledReason}` : ""}</p>}
                      </div>
                      <div className="flex items-center gap-3 text-sm font-semibold tabular-nums">
                        <span className="inline-flex items-center gap-1 text-success" title="Delivered">
                          <CheckCircle2 className="size-4" /> {w.last24h.succeeded}
                        </span>
                        <span className="inline-flex items-center gap-1 text-warn" title="Retrying">
                          <Clock className="size-4" /> {w.last24h.pending}
                        </span>
                        <span className="inline-flex items-center gap-1 text-danger" title="Gave up">
                          <XCircle className="size-4" /> {w.last24h.failed}
                        </span>
                        <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.webhooks.length < data.limits.maxWebhooks && <NewWebhook slug={slug} eventTypes={data.eventTypes} />}
        </div>

        <aside className="space-y-4">
          <Card title="How delivery works">
            <ul className="space-y-3 text-sm text-ink-2">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Signed with your secret, following <b>Standard Webhooks</b>. Check the signature before trusting a request.
                </span>
              </li>
              <li className="flex gap-2">
                <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Not a 2xx within 10 s? Retried {data.limits.maxAttempts - 1} times, after {data.limits.retryDelaysMs.map(hours).join(", ")}.
                </span>
              </li>
              <li className="flex gap-2">
                <PauseCircle className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>An endpoint that fails for a day straight, or answers 410, is switched off until you turn it back on.</span>
              </li>
              <li className="flex gap-2">
                <Webhook className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>Payloads carry ids and links, not scores or emails. Ballots are never sent: counts stay sealed.</span>
              </li>
            </ul>
            <Link href="/developers#guide-webhooks" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              Payloads and verification <ArrowRight className="size-4" />
            </Link>
          </Card>
          <Card title="Event types">
            <ul className="space-y-2">
              {data.eventTypes.map((t) => (
                <li key={t.type}>
                  <Pill className="font-mono">{t.type}</Pill>
                  <p className="mt-0.5 text-xs text-muted">{t.description}</p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
