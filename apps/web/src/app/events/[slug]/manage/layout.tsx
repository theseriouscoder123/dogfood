import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { getEvent } from "@/lib/data";
import { getMe } from "@/lib/session";
import { EmptyState } from "@/components/ui";
import { LogoTile } from "@/components/visuals";
import { ManageNav } from "./ManageNav";
import { DraftBanner } from "./DraftBanner";

export const metadata = { title: "Manage event" };

export default async function ManageLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getMe();
  if (!me.user) redirect(`/login?next=/events/${slug}/manage`);
  const { event, myRoles } = await getEvent(slug);
  const isStaff = me.user.isAdmin || myRoles.includes("organizer");

  if (!isStaff) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-16">
        <EmptyState icon={<ShieldAlert className="size-5" />} title="Organizers only">
          Only organizers of this event can manage it.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pt-8 sm:px-6 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="mb-5 flex items-center gap-3">
          <LogoTile seed={event.slug} src={event.logoUrl} name={event.name} className="size-11 text-sm" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Organizer console</div>
            <div className="truncate font-bold">{event.name}</div>
          </div>
        </div>
        <ManageNav base={`/events/${slug}/manage`} />
        <Link href={`/events/${slug}`} className="mt-4 flex items-center gap-1.5 px-3 text-sm font-semibold text-muted hover:text-ink">
          View public page <ArrowUpRight className="size-4" />
        </Link>
      </aside>
      <div className="min-w-0">
        {!event.publishedAt && <DraftBanner slug={slug} />}
        {children}
      </div>
    </div>
  );
}
