import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Sign up" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

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
        Invited as a judge or organizer? Sign up with the same email address to claim your account.
      </p>
    </AuthShell>
  );
}
