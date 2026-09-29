"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { send } from "@/lib/client";
import { Button, ErrorText, Field, inputClass, SuccessText } from "@/components/ui";

export function RegisterForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    const r = await send<{ pending?: boolean; message?: string }>("POST", "/api/auth/register", { name: form.get("name"), email: form.get("email"), password: form.get("password") });
    setPending(false);
    if (!r.ok) return setError(r.message);
    // An invited account: the owner sets their password from the emailed link.
    if (r.data?.pending) return setNotice(r.data.message ?? "Check your email to finish setting up your account.");
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Full name">
        <input name="name" required maxLength={100} autoComplete="name" autoFocus className={inputClass} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <ErrorText>{error}</ErrorText>
      {notice && <SuccessText>{notice}</SuccessText>}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
