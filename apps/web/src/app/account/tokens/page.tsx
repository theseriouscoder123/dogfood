import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { ApiTokenList } from "@/lib/types";
import { TokenManager } from "./TokenManager";

export const metadata = { title: "API tokens" };

export default async function TokensPage() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/account/tokens");
  const data = await api<ApiTokenList>("/api/auth/tokens");
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">Account</p>
          <h1 className="text-3xl font-extrabold">API tokens</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Tokens let scripts and integrations use the Dogfood API as you: exporting results, syncing projects, building a dashboard. A token can do only what you can do,
            limited further by its scope.
          </p>
        </div>
        <Link href="/developers" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <BookOpen className="size-4" /> API reference
        </Link>
      </div>
      <TokenManager initial={data} email={me.user.email} />
    </div>
  );
}
