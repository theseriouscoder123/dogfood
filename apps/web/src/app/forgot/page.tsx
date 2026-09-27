"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { send } from "@/lib/client";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorText, Field, inputClass } from "@/components/ui";

export default function ForgotPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {sentTo ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-success-soft text-success">
            <MailCheck className="size-6" />
          </div>
          <p className="font-semibold">Check your inbox</p>
          <p className="mt-1 text-sm text-muted">If an account exists for {sentTo}, a reset link is on its way. It expires in an hour.</p>
          <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
            Back to log in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get("email"));
            setPending(true);
            const r = await send("POST", "/api/auth/forgot", { email });
            setPending(false);
            if (!r.ok) return setError(r.message);
            setSentTo(email);
          }}
        >
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" autoFocus className={inputClass} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
