import Link from "next/link";
import { BookOpen } from "lucide-react";
import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { ApiTokenList } from "@/lib/types";
import { TokenManager } from "./TokenManager";

export const metadata = { title: "API tokens" };

export default async function TokensPage() {
  const me = await getMe();
  const data = await api<ApiTokenList>("/api/auth/tokens");
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">API tokens</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">For scripts and integrations. A token can only do what you can.</p>
        </div>
        <Link href="/developers" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <BookOpen className="size-4" /> API reference
        </Link>
      </div>
      <TokenManager initial={data} email={me.user!.email} />
    </>
  );
}
