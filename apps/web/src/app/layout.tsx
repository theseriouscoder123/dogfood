import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import { getMe } from "@/lib/session";
import { ThemeToggle, themeBootScript } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { LogoMark } from "@/components/visuals";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = {
  title: { default: "Dogfood · Hackathons, judged fairly", template: "%s · Dogfood" },
  description: "Open-source, self-hostable hackathon platform: registration, teams, submissions and fair judging.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const myEvents = new Map<string, { slug: string; name: string; roles: string[] }>();
  for (const r of me.roles) {
    const e = myEvents.get(r.event.slug) ?? { ...r.event, roles: [] };
    e.roles.push(r.role);
    myEvents.set(r.event.slug, e);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface/70">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark />
              <span className="font-display text-[19px] font-extrabold tracking-tight">Dogfood</span>
            </Link>
            <nav className="hidden items-center gap-1 text-sm font-semibold md:flex">
              <Link href="/#hackathons" className="rounded-lg px-3 py-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
                Hackathons
              </Link>
              {me.user?.isAdmin && (
                <Link href="/events/new" className="rounded-lg px-3 py-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
                  Host a hackathon
                </Link>
              )}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              {me.user ? (
                <UserMenu user={me.user} events={[...myEvents.values()]} />
              ) : (
                <>
                  <Link href="/login" className={buttonClass("ghost", "md")}>
                    Log in
                  </Link>
                  <Link href="/register" className={buttonClass("primary", "md")}>
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-20 border-t border-line bg-surface">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2.5">
              <LogoMark size={22} />
              <span>
                <span className="font-semibold text-ink">Dogfood</span> · open-source hackathon platform · MIT licensed
              </span>
            </div>
            <div className="flex gap-5">
              <Link href="/#hackathons" className="hover:text-ink">
                Hackathons
              </Link>
              <Link href="/developers" className="hover:text-ink">
                API
              </Link>
              <a href="/api/health" className="hover:text-ink">
                Status
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
