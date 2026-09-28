"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Award, Bell, KeyRound, ShieldCheck, UserRound } from "lucide-react";

const ITEMS = [
  { href: "/account/settings", label: "Profile", icon: UserRound },
  { href: "/account/security", label: "Password & sessions", icon: ShieldCheck },
  { href: "/account/notifications", label: "Notifications", icon: Bell },
  { href: "/account/records", label: "Certificates", icon: Award },
  { href: "/account/tokens", label: "API tokens", icon: KeyRound },
];

export function AccountNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${path === href ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
        >
          <Icon className="size-4" /> {label}
        </Link>
      ))}
    </nav>
  );
}
