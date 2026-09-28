import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import type { DeliveryStatus, WebhookDetail, WebhookList } from "@/lib/types";
import { WebhookConsole } from "./WebhookConsole";

export const metadata = { title: "Webhook" };

export default async function WebhookPage({ params, searchParams }: { params: Promise<{ slug: string; webhookId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { slug, webhookId } = await params;
  const { status } = await searchParams;
  const filter = (["pending", "succeeded", "failed"] as const).find((s) => s === status) ?? null;
  const e = encodeURIComponent(slug);
  const [detail, list] = await Promise.all([
    api<WebhookDetail>(`/api/events/${e}/webhooks/${encodeURIComponent(webhookId)}${filter ? `?status=${filter}` : ""}`),
    api<WebhookList>(`/api/events/${e}/webhooks`),
  ]);
  const counts = list.webhooks.find((w) => w.id === webhookId)?.last24h ?? { succeeded: 0, pending: 0, failed: 0 };

  return (
    <div className="space-y-6">
      <Link href={`/events/${slug}/manage/webhooks`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> All webhooks
      </Link>
      <WebhookConsole slug={slug} detail={detail} eventTypes={list.eventTypes} filter={filter as DeliveryStatus | null} counts={counts} />
    </div>
  );
}
