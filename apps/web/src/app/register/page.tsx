import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { SignedInNotice } from "@/components/SignedInNotice";
import { getMe } from "@/lib/session";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Sign up" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const me = await getMe();
  if (me.user)
    return (
      <AuthShell title="You're already signed in" subtitle="Carry on where you were, or sign out to use a different account.">
        <SignedInNotice user={me.user} next={safeNext} />
      </AuthShell>
    );

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already have one?{" "}
          <Link href={`/login?next=${encodeURIComponent(safeNext)}`} className="font-semibold text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <RegisterForm next={safeNext} />
      <p className="mt-6 rounded-xl bg-surface-2 px-4 py-3 text-xs text-muted">
        Invited as a judge or organizer? Sign up with the email address the invitation went to, and we'll email you a link to set your password.
      </p>
    </AuthShell>
  );
}
