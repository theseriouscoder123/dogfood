"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { send } from "@/lib/client";
import type { WebhookEndpoint } from "@/lib/types";
import { Button, Card, ErrorText, Field, inputClass } from "@/components/ui";
import { SecretReveal } from "./SecretReveal";
import { EventTypePicker } from "./EventTypePicker";

export function NewWebhook({ slug, eventTypes }: { slug: string; eventTypes: Array<{ type: string; description: string }> }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ webhook: WebhookEndpoint; secret: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await send<{ webhook: WebhookEndpoint; secret: string }>("POST", `/api/events/${slug}/webhooks`, { url, description, eventTypes: types });
    if (!r.ok) {
      setPending(false);
      return setError(r.message);
    }
    // A first test delivery, so the log shows straight away whether the endpoint is reachable.
    await send("POST", `/api/events/${slug}/webhooks/${r.data.webhook.id}/ping`);
    setPending(false);
    setCreated(r.data);
    setUrl("");
    setDescription("");
    setTypes([]);
    router.refresh();
  }

  if (created) {
    return (
      <SecretReveal
        title="Endpoint added. Copy its signing secret now."
        secret={created.secret}
        note="It's shown only once. A test delivery is on its way."
        action={{ label: "Open its delivery log", href: `/events/${slug}/manage/webhooks/${created.webhook.id}` }}
        onDone={() => setCreated(null)}
      />
    );
  }

  return (
    <Card title="Add an endpoint">
      <form onSubmit={create} className="space-y-5">
        <Field label="Payload URL" hint="Where we POST JSON. Private and internal addresses are refused." required>
          <input className={`${inputClass} font-mono`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.org/hooks/dogfood" required />
        </Field>
        <Field label="Description" hint="So your co-organizers know what it's for.">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Post new submissions to #hackathon" />
        </Field>
        <EventTypePicker eventTypes={eventTypes} value={types} onChange={setTypes} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending || !url.trim()}>
          <Plus className="size-4" /> {pending ? "Adding…" : "Add endpoint"}
        </Button>
      </form>
    </Card>
  );
}
