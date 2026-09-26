"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "Login failed.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-md bg-zinc-900 px-3 py-2 text-white hover:bg-zinc-700 disabled:opacity-50">
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
