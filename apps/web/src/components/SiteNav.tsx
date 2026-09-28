"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code2, Compass, LayoutDashboard, Layers, LogIn, Menu, PlusCircle, UserPlus, X } from "lucide-react";

export type NavLink = { href: string; label: string; icon: "dashboard" | "hackathons" | "projects" | "host" | "developers" };

const ICONS = { dashboard: LayoutDashboard, hackathons: Compass, projects: Layers, host: PlusCircle, developers: Code2 };

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function DesktopNav({ links }: { links: NavLink[] }) {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-0.5 text-sm font-semibold lg:flex">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-lg px-3 py-2 transition ${isActive(path, l.href) ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav({ links, signedIn }: { links: NavLink[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink-2 hover:border-line-strong">
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {/* Portalled: the header's backdrop blur would otherwise trap a fixed panel inside it. */}
      {open &&
        createPortal(
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 overflow-y-auto border-t border-line bg-bg px-4 pb-10 pt-4">
          <nav className="grid gap-1">
            {links.map((l) => {
              const Icon = ICONS[l.icon];
              return (
                <Link key={l.href} href={l.href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-base font-semibold ${isActive(path, l.href) ? "bg-primary-soft text-primary" : "text-ink hover:bg-surface-2"}`}>
                  <Icon className="size-5" /> {l.label}
                </Link>
              );
            })}
          </nav>
          {!signedIn && (
            <div className="mt-6 grid gap-2 border-t border-line pt-6">
              <Link href="/login" className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface py-3 font-semibold">
                <LogIn className="size-4" /> Log in
              </Link>
              <Link href="/register" className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-ink">
                <UserPlus className="size-4" /> Sign up
              </Link>
            </div>
          )}
        </div>,
          document.body,
        )}
    </div>
  );
}
