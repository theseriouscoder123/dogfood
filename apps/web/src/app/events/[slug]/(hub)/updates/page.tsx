import { Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { getEvent } from "@/lib/data";
import { getMe } from "@/lib/session";
import { HubColumns } from "@/components/HubColumns";
import { EmptyState } from "@/components/ui";
import { Updates, type Announcement } from "./Updates";

export const metadata = { title: "Updates" };

export default async function UpdatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ announcements }, detail, me] = await Promise.all([api<{ announcements: Announcement[] }>(`/api/events/${encodeURIComponent(slug)}/announcements`), getEvent(slug), getMe()]);
  const staff = !!me.user?.isAdmin || detail.myRoles.includes("organizer");
  return (
    <HubColumns slug={slug}>
      {announcements.length === 0 && !staff ? (
        <EmptyState icon={<Megaphone className="size-5" />} title="No updates yet" />
      ) : (
        <Updates slug={slug} announcements={announcements} staff={staff} />
      )}
    </HubColumns>
  );
}
