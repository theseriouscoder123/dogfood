"use client";

import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { send } from "@/lib/client";
import { Button } from "@/components/ui";
import { useDialog, useToast } from "@/components/feedback";

export function DuplicateButton({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const ask = useDialog();
  const toast = useToast();
  const next = name.replace(/\d{4}/, (y) => String(Number(y) + 1));

  async function duplicate() {
    const newName = await ask.prompt({
      title: "Duplicate this hackathon",
      body: "A new draft with the same setup. Dates shift so submissions open in 30 days.",
      label: "Name",
      initial: next === name ? `${name} (copy)` : next,
      confirmLabel: "Duplicate",
    });
    if (!newName) return;
    const r = await send<{ event: { slug: string } }>("POST", `/api/events/${slug}/duplicate`, { name: newName });
    if (!r.ok) return toast.error(r.message);
    toast.success("Draft created");
    router.push(`/events/${r.data.event.slug}/manage`);
  }

  return (
    <Button size="sm" variant="secondary" onClick={duplicate}>
      <Copy className="size-4" /> Duplicate
    </Button>
  );
}
