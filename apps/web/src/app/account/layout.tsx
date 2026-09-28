import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { AccountNav } from "./AccountNav";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/account/settings");
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 pt-10 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 hidden px-3 text-[11px] font-bold uppercase tracking-wider text-muted lg:block">Account</p>
        <AccountNav />
      </aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
