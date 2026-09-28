"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { send } from "@/lib/client";
import { Card } from "@/components/ui";
import { useToast } from "@/components/feedback";
import { CATEGORY_ICON } from "@/components/NotificationBell";

type Prefs = { email: boolean; muted: string[]; categories: Record<string, string> };

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-surface-3"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function NotificationPrefs({ initial }: { initial: Prefs }) {
  const toast = useToast();
  const [p, setP] = useState(initial);

  async function save(next: Prefs) {
    const before = p;
    setP(next);
    const r = await send<Prefs>("PUT", "/api/me/notification-settings", { email: next.email, muted: next.muted });
    if (!r.ok) {
      setP(before);
      toast.error(r.message);
    } else toast.success("Saved");
  }

  return (
    <>
      <Card>
        <div className="flex items-center gap-4">
          <Mail className="size-5 text-muted" />
          <div className="flex-1">
            <p className="font-semibold">Email me too</p>
            <p className="text-sm text-muted">Deadlines, judging, results and organizer alerts.</p>
          </div>
          <Toggle label="Email notifications" on={p.email} onChange={(email) => save({ ...p, email })} />
        </div>
      </Card>
      <Card title="What to notify me about" padded={false}>
        <ul className="divide-y divide-line border-t border-line">
          {Object.entries(p.categories).map(([key, label]) => {
            const Icon = CATEGORY_ICON[key]!;
            const on = !p.muted.includes(key);
            return (
              <li key={key} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
                <Icon className="size-4 text-muted" />
                <span className="flex-1 text-sm font-semibold">{label}</span>
                <Toggle label={label} on={on} onChange={(v) => save({ ...p, muted: v ? p.muted.filter((m) => m !== key) : [...p.muted, key] })} />
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
