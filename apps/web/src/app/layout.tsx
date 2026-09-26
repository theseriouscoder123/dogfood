import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "Dogfood Portal",
  description: "Self-hostable hackathon submission and judging portal",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Me>("/api/auth/me").catch(() => ({ user: null, roles: [] }) as Me);

  return (
    <html lang="en">
      <body>
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Dogfood Portal
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="text-zinc-600 hover:text-zinc-900">
                Events
              </Link>
              {me.user ? (
                <>
                  <span className="text-zinc-500">
                    {me.user.name}
                    {me.user.isAdmin && <span className="ml-1 rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-white">admin</span>}
                  </span>
                  <LogoutButton />
                </>
              ) : (
                <Link href="/login" className="rounded-md bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-700">
                  Log in
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
