"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Rocket } from "lucide-react";
import { send } from "@/lib/client";
import { Button } from "@/components/ui";
import { useDialog, useToast } from "@/components/feedback";

export function DraftBanner({ slug }: { slug: string }) {
  const router = useRouter();
  const ask = useDialog();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function publish() {
    if (!(await ask.confirm({ title: "Publish this hackathon?", body: "It appears in listings and people can register.", confirmLabel: "Publish" }))) return;
    setPending(true);
    const r = await send("POST", `/api/events/${slug}/publish`);
    setPending(false);
    if (!r.ok) return toast.error(r.message);
    toast.success("Published. It's live.");
    router.refresh();
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-warn/30 bg-warn-soft p-4 sm:flex-row sm:items-center">
      <EyeOff className="size-5 shrink-0 text-warn" />
      <p className="flex-1 text-sm">
        <b>Draft.</b> Only organizers can see this hackathon.
      </p>
      <Button size="sm" onClick={publish} disabled={pending}>
        <Rocket className="size-4" /> {pending ? "Publishing…" : "Publish"}
      </Button>
    </div>
  );
}
