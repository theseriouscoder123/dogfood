import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import { getMe } from "@/lib/session";
import { ThemeToggle, themeBootScript } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { LogoMark } from "@/components/visuals";
import { buttonClass } from "@/components/ui";
import { FeedbackProvider } from "@/components/feedback";
import { DesktopNav, MobileNav, type NavLink } from "@/components/SiteNav";
import { NotificationBell } from "@/components/NotificationBell";
import { ViewSwitcher } from "@/components/ViewSwitcher";
import { currentView, viewsFor } from "@/lib/view";

export const metadata: Metadata = {
  title: { default: "Verdict · Hackathons, judged fairly", template: "%s · Verdict" },
  description: "Open-source, self-hostable hackathon platform: registration, teams, submissions and fair judging.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The embeddable gallery lives inside other people's pages: no chrome, and no session lookup.
  if ((await headers()).get("x-dogfood-embed") === "1") {
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        </head>
        <body>
          <main>{children}</main>
        </body>
      </html>
    );
  }
  const me = await getMe();
  const myEvents = new Map<string, { slug: string; name: string; roles: string[] }>();
  for (const r of me.roles) {
    const e = myEvents.get(r.event.slug) ?? { ...r.event, roles: [] };
    e.roles.push(r.role);
    myEvents.set(r.event.slug, e);
  }

  const views = viewsFor(me);
  const view = await currentView(me);
  const eventRoles = Object.fromEntries([...myEvents.values()].map((e) => [e.slug, e.roles]));
  const switcher = (variant: "menu" | "list") =>
    me.user && <ViewSwitcher views={views} current={view} eventRoles={eventRoles} isAdmin={me.user.isAdmin} variant={variant} />;

  // Each view keeps the header to what that role needs.
  const links: NavLink[] = [
    ...(me.user ? [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" as const }] : []),
    { href: "/hackathons", label: "Hackathons", icon: "hackathons" },
    ...(view !== "organizer" ? [{ href: "/projects", label: "Projects", icon: "projects" as const }] : []),
    ...(view !== "judge" ? [{ href: me.user ? "/events/new" : "/login?next=/events/new", label: "Host a hackathon", icon: "host" as const }] : []),
    { href: "/developers", label: "Developers", icon: "developers" },
  ];

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <FeedbackProvider>
          <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface/70">
            <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 xl:gap-6">
              <Link href={me.user ? "/dashboard" : "/"} className="flex shrink-0 items-center gap-2.5">
                <LogoMark />
                <span className="font-display text-[19px] font-extrabold tracking-tight">Verdict</span>
              </Link>
              <DesktopNav links={links} />
              <div className="ml-auto flex items-center gap-2">
                {switcher("menu")}
                <ThemeToggle />
                {me.user && <NotificationBell />}
                {me.user ? (
                  <UserMenu user={me.user} events={[...myEvents.values()]} />
                ) : (
                  <div className="hidden items-center gap-2 sm:flex">
                    <Link href="/login" className={buttonClass("ghost", "md")}>
                      Log in
                    </Link>
                    <Link href="/register" className={buttonClass("primary", "md")}>
                      Sign up
                    </Link>
                  </div>
                )}
                <MobileNav links={links} signedIn={!!me.user} top={switcher("list")} />
              </div>
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="mt-20 border-t border-line bg-surface">
            <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
              <div>
                <div className="flex items-center gap-2.5">
                  <LogoMark size={24} />
                  <span className="font-display text-base font-extrabold text-ink">Verdict</span>
                </div>
                <p className="mt-3 max-w-xs text-muted">Run hackathons end to end: teams, submissions, judging, community voting and certificates. Open source, self-hosted.</p>
              </div>
              {[
                { title: "Explore", links: [["/hackathons", "Hackathons"], ["/projects", "Projects"], ["/events/new", "Host a hackathon"]] },
                { title: "Developers", links: [["/developers", "API reference"], ["/developers#guide-webhooks", "Webhooks"], ["/api/openapi.json", "OpenAPI spec"]] },
                { title: "Platform", links: [["/api/health", "Status"], ["/api/records/keys", "Signing keys"], ["/account/settings", "Account"]] },
              ].map((col) => (
                <div key={col.title}>
                  <p className="text-xs font-bold uppercase tracking-wider text-ink">{col.title}</p>
                  <ul className="mt-3 space-y-2">
                    {col.links.map(([href, label]) => (
                      <li key={href}>
                        <Link href={href!} className="text-muted hover:text-ink">
                          {label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="border-t border-line">
              <p className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted sm:px-6">© {new Date().getUTCFullYear()} Verdict contributors · MIT License</p>
            </div>
          </footer>
        </FeedbackProvider>
      </body>
    </html>
  );
}
