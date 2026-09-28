"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { send } from "@/lib/client";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorText } from "@/components/ui";

/**
 * Landing page for one-time sign-in links. Signing in needs a click on purpose: mail scanners
 * that open every link in an email would otherwise use up the single-use token before the
 * person ever sees it.
 */
export default function SignInLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AuthShell title="Confirm it's you" subtitle="This link signs you in and confirms your email address. It works once.">
      <div className="space-y-5">
        <Button
          size="lg"
          className="w-full"
          disabled={pending}
          autoFocus
          onClick={async () => {
            setPending(true);
            const r = await send<{ next: string }>("POST", "/api/auth/link/verify", { token });
            setPending(false);
            if (!r.ok) return setError(r.message);
            router.replace(r.data.next && r.data.next !== "/" ? r.data.next : "/dashboard");
            router.refresh();
          }}
        >
          {pending ? "Signing in…" : "Continue"}
        </Button>
        <ErrorText>
          {error}
          {error && (
            <>
              {" "}
              <Link href="/" className="font-semibold underline">
                Back to Dogfood
              </Link>
            </>
          )}
        </ErrorText>
      </div>
    </AuthShell>
  );
}
