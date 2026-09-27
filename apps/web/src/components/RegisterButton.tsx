"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { send } from "@/lib/client";
import { Button } from "@/components/ui";

export function RegisterButton({ slug, className = "", label = "Register now" }: { slug: string; className?: string; label?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className={className}>
      <Button
        variant="accent"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const r = await send("POST", `/api/events/${slug}/register`);
          setPending(false);
          if (!r.ok) return setError(r.message);
          router.push(`/events/${slug}/team`);
          router.refresh();
        }}
      >
        {pending ? "Registering…" : label}
      </Button>
      {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
