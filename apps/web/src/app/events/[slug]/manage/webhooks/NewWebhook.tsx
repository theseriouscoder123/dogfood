"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { send } from "@/lib/client";
import type { WebhookEndpoint } from "@/lib/types";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { useToast } from "@/components/feedback";
import { SecretReveal } from "./SecretReveal";
import { EventTypePicker } from "./EventTypePicker";
import { FORMATS, type Format } from "./formats";

/** A sensible channel feed: the moments a team chat cares about. */
const CHAT_DEFAULT = ["project.submitted", "results.published", "peoples_choice.published", "comment.reported"];

export function NewWebhook({ slug, eventTypes, onClose }: { slug: string; eventTypes: Array<{ type: string; description: string }>; onClose?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [format, setFormat] = useState<Format>("slack");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [types, setTypes] = useState<string[]>(CHAT_DEFAULT);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ webhook: WebhookEndpoint; secret: string } | null>(null);
  const f = FORMATS.find((x) => x.key === format)!;

  function pick(next: Format) {
    setFormat(next);
    setTypes(next === "standard" ? [] : CHAT_DEFAULT);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await send<{ webhook: WebhookEndpoint; secret: string }>("POST", `/api/events/${slug}/webhooks`, { url, description, eventTypes: types, format });
    if (!r.ok) {
      setPending(false);
      return toast.error(r.message);
    }
    await send("POST", `/api/events/${slug}/webhooks/${r.data.webhook.id}/ping`);
    setPending(false);
    router.refresh();
    if (format === "standard") return setCreated(r.data);
    toast.success(`Connected. A test message is on its way to ${f.label}.`);
    onClose?.();
  }

  if (created) {
    return (
      <SecretReveal
        title="Endpoint added. Copy its signing secret."
        secret={created.secret}
        note="Shown once. Use it to verify each request."
        action={{ label: "Delivery log", href: `/events/${slug}/manage/webhooks/${created.webhook.id}` }}
        onDone={() => {
          setCreated(null);
          onClose?.();
        }}
      />
    );
  }

  return (
    <Card
      title="New endpoint"
      actions={
        onClose && (
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
            <X className="size-4" />
          </button>
        )
      }
    >
      <form onSubmit={create} className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {FORMATS.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => pick(x.key)}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${format === x.key ? "border-primary bg-primary-soft/60 ring-4 ring-primary/10" : "border-line hover:border-line-strong"}`}
            >
              <x.icon className={`size-5 ${format === x.key ? "text-primary" : "text-muted"}`} />
              <span className="text-sm font-bold">{x.label}</span>
            </button>
          ))}
        </div>
        <Field label="URL" hint={f.hint} required>
          <input className={`${inputClass} font-mono`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={f.placeholder} required />
        </Field>
        <Field label="Name">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder={format === "standard" ? "CRM sync" : "#hackathon-updates"} />
        </Field>
        <EventTypePicker eventTypes={eventTypes} value={types} onChange={setTypes} />
        <div className="flex justify-end gap-2">
          {onClose && (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending || !url.trim()}>
            <Plus className="size-4" /> {pending ? "Adding…" : "Add endpoint"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
