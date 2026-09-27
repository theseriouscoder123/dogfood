import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only allow same-site relative redirects after login.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

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
