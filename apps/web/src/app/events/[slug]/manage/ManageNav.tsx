"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CalendarClock, Download, Medal, FileQuestion, Gavel, Gift, LayoutDashboard, Layers, Network, Palette, Scale, UserCog } from "lucide-react";

const GROUPS = [
  {
    label: "Event",
    items: [
      { path: "", label: "Dashboard", icon: LayoutDashboard },
      { path: "/details", label: "Details & branding", icon: Palette },
      { path: "/schedule", label: "Schedule", icon: CalendarClock },
      { path: "/tracks", label: "Tracks", icon: Layers },
      { path: "/prizes", label: "Prizes", icon: Gift },
      { path: "/questions", label: "Submission form", icon: FileQuestion },
      { path: "/organizers", label: "Organizers", icon: UserCog },
    ],
  },
  {
    label: "Judging",
    items: [
      { path: "/rubric", label: "Rubric", icon: Scale },
      { path: "/judges", label: "Judges", icon: Gavel },
      { path: "/assignments", label: "Assignments", icon: Network },
      { path: "/progress", label: "Progress", icon: Activity },
      { path: "/results", label: "Results", icon: Medal },
    ],
  },
  {
    label: "Data",
    items: [{ path: "/exports", label: "Exports", icon: Download }],
  },
];

export function ManageNav({ base }: { base: string }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-4">
      {GROUPS.map((g) => (
        <div key={g.label} className="flex gap-1 lg:flex-col">
          <p className="hidden px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted lg:block">{g.label}</p>
          {g.items.map(({ path: p, label, icon: Icon }) => {
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
        </div>
      ))}
    </nav>
  );
}
