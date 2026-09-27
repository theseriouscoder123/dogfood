"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { send } from "@/lib/client";
import { Button, ErrorText } from "@/components/ui";

export function JoinButton({ token, slug }: { token: string; slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        size="lg"
        variant="accent"
        className="w-full"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const r = await send("POST", `/api/invites/${encodeURIComponent(token)}/accept`);
          setPending(false);
          if (!r.ok) return setError(r.message);
          router.push(`/events/${slug}/team`);
          router.refresh();
        }}
      >
        {pending ? "Joining…" : "Join the team"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
