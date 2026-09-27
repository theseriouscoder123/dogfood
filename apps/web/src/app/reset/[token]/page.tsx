"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { send } from "@/lib/client";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorText, Field, inputClass } from "@/components/ui";

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AuthShell title="Choose a new password" subtitle="You'll be logged in, and signed out everywhere else.">
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (f.get("password") !== f.get("confirm")) return setError("The two passwords don't match.");
          setPending(true);
          const r = await send("POST", "/api/auth/reset", { token, password: f.get("password") });
          setPending(false);
          if (!r.ok) return setError(r.message);
          router.push("/");
          router.refresh();
        }}
      >
        <Field label="New password" hint="At least 8 characters.">
          <input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus className={inputClass} />
        </Field>
        <Field label="Confirm password">
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </Field>
        <ErrorText>
          {error}
          {error?.includes("expired") && (
            <>
              {" "}
              <Link href="/forgot" className="font-semibold underline">
                Get a new link
              </Link>
            </>
          )}
        </ErrorText>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Set password and log in"}
        </Button>
      </form>
    </AuthShell>
  );
}
