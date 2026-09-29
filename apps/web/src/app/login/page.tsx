import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { SignedInNotice } from "@/components/SignedInNotice";
import { getMe } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only allow same-site relative redirects after login.
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
      title="Welcome back"
      subtitle={
        <>
          New here?{" "}
          <Link href={`/register?next=${encodeURIComponent(safeNext)}`} className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={safeNext} />
    </AuthShell>
  );
}
