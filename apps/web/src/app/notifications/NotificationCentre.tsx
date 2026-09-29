"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, Settings } from "lucide-react";
import { send } from "@/lib/client";
import { Button, Card } from "@/components/ui";
import { NotificationRow, notificationsChanged, type Notification } from "@/components/NotificationBell";

export function NotificationCentre() {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      const q = new URLSearchParams({ ...(filter === "unread" ? { unread: "true" } : {}), ...(before ? { before } : {}) });
      const r = await send<{ notifications: Notification[]; unread: number }>("GET", `/api/me/notifications?${q}`);
      if (!r.ok) return;
      setItems((xs) => (before && xs ? [...xs, ...r.data.notifications] : r.data.notifications));
      setUnread(r.data.unread);
      setMore(r.data.notifications.length === 30);
    },
    [filter],
  );

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function readAll() {
    await send("POST", "/api/me/notifications/read", { all: true });
    notificationsChanged();
    void load();
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Notifications</h1>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Button size="sm" variant="secondary" onClick={readAll}>
              <CheckCheck className="size-4" /> Mark all read
            </Button>
          )}
          <Link href="/account/notifications" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Notification settings">
            <Settings className="size-4" />
          </Link>
        </div>
      </div>
      <div className="mb-4 flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${filter === f ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
          >
            {f === "all" ? "All" : `Unread${unread ? ` (${unread})` : ""}`}
          </button>
        ))}
      </div>
      <Card padded={false}>
        {items === null ? (
          <p className="px-6 py-10 text-center text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center text-sm text-muted">
            <BellOff className="mb-2 size-7" />
            {filter === "unread" ? "No unread notifications." : "Nothing yet. Activity on your teams, projects and judging shows up here."}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onOpen={() => {
                  if (!n.readAt) void send("POST", "/api/me/notifications/read", { ids: [n.id] }).then(notificationsChanged);
                  router.push(n.url || "/notifications");
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      {more && items && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => load(items[items.length - 1]!.createdAt)}>
            Load older
          </Button>
        </div>
      )}
    </>
  );
}
