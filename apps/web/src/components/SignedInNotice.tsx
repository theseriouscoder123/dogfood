"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LogOut } from "lucide-react";
import { Avatar } from "./visuals";
import { buttonClass } from "./ui";

/** Shown on the log-in and sign-up pages to someone who is already signed in. */
export function SignedInNotice({ user, next }: { user: { name: string; email: string; avatarUrl: string | null }; next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
      <div className="flex items-center gap-3">
        <Avatar name={user.name} src={user.avatarUrl} size={44} className="ring-0" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-2">
        <Link href={next} className={buttonClass("primary", "lg", "gap-2")}>
          Continue as {user.name.split(" ")[0]} <ArrowRight className="size-4" />
        </Link>
        <button
          type="button"
          disabled={pending}
          className={buttonClass("secondary", "lg", "gap-2")}
          onClick={async () => {
            setPending(true);
            await fetch("/api/auth/logout", { method: "POST" });
            router.refresh();
            setPending(false);
          }}
        >
          <LogOut className="size-4" /> {pending ? "Signing out…" : "Sign out and use another account"}
        </button>
      </div>
    </div>
  );
}
