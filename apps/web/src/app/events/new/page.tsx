import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getMe } from "@/lib/session";
import { EventForm } from "@/components/EventForm";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Host a hackathon" };

export default async function NewEventPage() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/events/new");

  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      {!me.user.isAdmin ? (
        <EmptyState icon={<ShieldAlert className="size-5" />} title="Only admins can create hackathons">
          Ask a platform admin to create one and add you as an organizer.
        </EmptyState>
      ) : (
        <>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">New hackathon</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Host a hackathon</h1>
          <p className="mb-8 mt-2 text-muted">You become its first organizer. Everything here can be changed later.</p>
          <EventForm
            mode="create"
            initial={{ registrationOpensAt: null, submissionsOpenAt: null, submissionsCloseAt: null, judgingOpensAt: null, judgingClosesAt: null, maxTeamSize: 4 }}
          />
        </>
      )}
    </div>
  );
}
