"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, Bell, BellOff, CheckCheck, Gavel, Megaphone, MessageSquare, Send, ShieldAlert, Timer, Users } from "lucide-react";
import { send } from "@/lib/client";

export type Notification = { id: string; category: string; title: string; body: string; url: string; readAt: string | null; createdAt: string };

export const CATEGORY_ICON: Record<string, typeof Bell> = {
  announcements: Megaphone,
  team: Users,
  submissions: Send,
  judging: Gavel,
  results: Award,
  comments: MessageSquare,
  organizer: ShieldAlert,
  reminders: Timer,
};

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await send<{ notifications: Notification[]; unread: number }>("GET", "/api/me/notifications");
    if (r.ok) {
      setItems(r.data.notifications.slice(0, 8));
      setUnread(r.data.unread);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      clearInterval(t);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [load]);

  async function openOne(n: Notification) {
    setOpen(false);
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      void send("POST", "/api/me/notifications/read", { ids: [n.id] });
    }
    router.push(n.url || "/notifications");
  }

  async function readAll() {
    await send("POST", "/api/me/notifications/read", { all: true });
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        className="relative grid size-10 place-items-center rounded-full border border-line bg-surface text-ink-2 transition hover:border-line-strong hover:text-ink"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-extrabold tabular-nums text-white ring-2 ring-surface">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-bold">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center text-sm text-muted">
              <BellOff className="mb-2 size-6" /> You&apos;re all caught up.
            </div>
          ) : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={() => openOne(n)} />
              ))}
            </ul>
          )}
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm font-semibold text-primary hover:bg-surface-2">
            See all
          </Link>
        </div>
      )}
    </div>
  );
}

export function NotificationRow({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  const Icon = CATEGORY_ICON[n.category] ?? Bell;
  return (
    <li>
      <button type="button" onClick={onOpen} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-surface-2 ${n.readAt ? "" : "bg-primary-soft/40"}`}>
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${n.readAt ? "bg-surface-2 text-muted" : "bg-primary-soft text-primary"}`}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${n.readAt ? "text-ink-2" : "font-semibold"}`}>{n.title}</span>
          {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
          <span className="mt-1 block text-[11px] text-muted">{ago(n.createdAt)}</span>
        </span>
        {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
      </button>
    </li>
  );
}
