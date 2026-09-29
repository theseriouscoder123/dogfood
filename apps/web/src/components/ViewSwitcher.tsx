"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import type { View } from "@/lib/view";
import { VIEWS } from "./viewMeta";

type Props = {
  views: View[];
  current: View;
  /** Event slug → the roles held there, to land on the right page of the event you're on. */
  eventRoles: Record<string, string[]>;
  isAdmin: boolean;
  /** "menu": a dropdown for the header. "list": inline buttons for the mobile menu. */
  variant?: "menu" | "list";
};

export function ViewSwitcher({ views, current, eventRoles, isAdmin, variant = "menu" }: Props) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  if (views.length < 2) return null;

  function choose(v: View) {
    setOpen(false);
    document.cookie = `dogfood-view=${v}; path=/; max-age=31536000; samesite=lax`;
    // On an event you have that role in, go to its page for the new view; otherwise, the dashboard.
    const slug = path.match(/^\/events\/([^/]+)/)?.[1];
    const roles = slug && slug !== "new" && slug !== "import" ? (eventRoles[slug] ?? []) : null;
    let dest = "/dashboard";
    if (roles && slug) {
      if (v === "organizer" && (roles.includes("organizer") || isAdmin)) dest = `/events/${slug}/manage`;
      else if (v === "judge" && roles.includes("judge")) dest = `/events/${slug}/judging`;
      else if (v === "participant") dest = `/events/${slug}`;
    }
    router.push(dest);
    router.refresh();
  }

  if (variant === "list") {
    return (
      <div className="mb-4 rounded-2xl border border-line bg-surface p-2">
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-muted">View as</p>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}>
          {views.map((v) => {
            const { label, icon: Icon } = VIEWS[v];
            return (
              <button
                key={v}
                type="button"
                aria-pressed={v === current}
                onClick={() => choose(v)}
                className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-sm font-semibold ${v === current ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-surface-2"}`}
              >
                <Icon className="size-5" /> {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const { label, icon: Icon } = VIEWS[current];
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Viewing as ${label}. Switch view`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface pl-3 pr-2.5 text-sm font-semibold transition hover:border-line-strong"
      >
        <Icon className="size-4 text-primary" />
        <span className="hidden xl:inline">{label}</span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-lift">
          <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">View as</p>
          {views.map((v) => {
            const { label: l, blurb, icon: I } = VIEWS[v];
            return (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                aria-checked={v === current}
                onClick={() => choose(v)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-2 ${v === current ? "bg-primary-soft/60" : ""}`}
              >
                <I className={`mt-0.5 size-4 shrink-0 ${v === current ? "text-primary" : "text-muted"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{l}</span>
                  <span className="block text-xs text-muted">{blurb}</span>
                </span>
                {v === current && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
