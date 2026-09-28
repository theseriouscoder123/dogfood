import { api } from "@/lib/api";
import type { WebhookList } from "@/lib/types";
import { WebhooksBoard } from "./WebhooksBoard";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<WebhookList>(`/api/events/${encodeURIComponent(slug)}/webhooks`);
  return <WebhooksBoard slug={slug} data={data} />;
}
