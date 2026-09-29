"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, BookOpen, ChevronDown, KeyRound, LayoutDashboard, LogOut, PlusCircle, Settings, Trophy, Upload, UserRound } from "lucide-react";
import { Avatar } from "./visuals";

type Props = {
  user: { name: string; email: string; isAdmin: boolean; handle: string; avatarUrl: string | null };
  events: Array<{ slug: string; name: string; roles: string[] }>;
};

export function UserMenu({ user, events }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 transition hover:border-line-strong"
      >
        <Avatar name={user.name} src={user.avatarUrl} size={28} className="ring-0" />
        <span className="hidden max-w-32 truncate text-sm font-semibold sm:block lg:hidden xl:block">{user.name.split(" ")[0]}</span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
          <Link href={`/u/${user.handle}`} onClick={() => setOpen(false)} className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-surface-2">
            <Avatar name={user.name} src={user.avatarUrl} size={38} className="ring-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                <span className="truncate">{user.name}</span>
                {user.isAdmin && <span className="rounded-md bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bg">Admin</span>}
              </div>
              <div className="truncate text-xs text-muted">@{user.handle}</div>
            </div>
          </Link>
          <div className="border-b border-line py-2">
            {[
              { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
              { href: `/u/${user.handle}`, icon: UserRound, label: "Your profile" },
              { href: "/account/settings", icon: Settings, label: "Settings" },
            ].map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
                <l.icon className="size-4 text-muted" /> {l.label}
              </Link>
            ))}
          </div>
          {events.length > 0 && (
            <div className="border-b border-line py-2">
              <p className="px-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Your hackathons</p>
              {events.slice(0, 6).map((e) => (
                <Link key={e.slug} href={`/events/${e.slug}`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-surface-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Trophy className="size-4 shrink-0 text-muted" />
                    <span className="truncate">{e.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold capitalize text-muted">{e.roles.join(" · ")}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="py-2">
            <Link href="/events/new" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
              <PlusCircle className="size-4 text-muted" /> Host a hackathon
            </Link>
            {user.isAdmin && (
              <Link href="/events/import" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
                <Upload className="size-4 text-muted" /> Import an event
              </Link>
            )}
            <Link href="/account/records" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
              <Award className="size-4 text-muted" /> My certificates
            </Link>
            <Link href="/account/tokens" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
              <KeyRound className="size-4 text-muted" /> API tokens
            </Link>
            <Link href="/developers" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
              <BookOpen className="size-4 text-muted" /> API reference
            </Link>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger hover:bg-danger-soft"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                setOpen(false);
                router.push("/");
                router.refresh();
              }}
            >
              <LogOut className="size-4" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
