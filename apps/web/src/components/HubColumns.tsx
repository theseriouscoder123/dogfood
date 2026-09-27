import { getEvent, getMyTeam } from "@/lib/data";
import { getMe } from "@/lib/session";
import { EventSidebar } from "./EventSidebar";

/** Main content on the left, the event's status/CTA sidebar on the right. */
export async function HubColumns({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [data, me] = await Promise.all([getEvent(slug), getMe()]);
  const team = me.user ? await getMyTeam(slug) : null;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">{children}</div>
      {/* On phones the status/CTA card comes first, like a sticky "Register" bar on Unstop. */}
      <div className="order-first lg:order-none">
        <EventSidebar data={data} me={me} team={team} />
      </div>
    </div>
  );
}
