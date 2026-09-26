import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only allow same-site relative redirects after login.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <div className="mx-auto max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
      <h1 className="mb-4 text-xl font-semibold">Log in</h1>
      <LoginForm next={safeNext} />
    </div>
  );
}
