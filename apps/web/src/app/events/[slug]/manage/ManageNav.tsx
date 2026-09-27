"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, FileQuestion, Gift, LayoutDashboard, Layers, Palette, UserCog } from "lucide-react";

const ITEMS = [
  { path: "", label: "Dashboard", icon: LayoutDashboard },
  { path: "/details", label: "Details & branding", icon: Palette },
  { path: "/schedule", label: "Schedule", icon: CalendarClock },
  { path: "/tracks", label: "Tracks", icon: Layers },
  { path: "/prizes", label: "Prizes", icon: Gift },
  { path: "/questions", label: "Submission form", icon: FileQuestion },
  { path: "/organizers", label: "Organizers", icon: UserCog },
];

export function ManageNav({ base }: { base: string }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col">
      {ITEMS.map(({ path: p, label, icon: Icon }) => {
        const href = base + p;
        const active = path === href;
        return (
          <Link
            key={p}
            href={href}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              active ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon className="size-[18px]" /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
