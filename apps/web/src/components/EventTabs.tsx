"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function EventTabs({ tabs }: { tabs: Array<{ href: string; label: string; count?: number; exact?: boolean }> }) {
  const path = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Event sections">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-3.5 text-sm font-semibold transition ${
              active ? "border-primary text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted"}`}>{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
