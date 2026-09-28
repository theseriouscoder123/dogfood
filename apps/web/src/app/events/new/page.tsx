import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { EventForm } from "@/components/EventForm";

export const metadata = { title: "Host a hackathon" };

export default async function NewEventPage() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/events/new");

  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Host a hackathon</h1>
      <p className="mb-8 mt-2 text-muted">
        It stays private until you publish it. Moving from another Dogfood?{" "}
        <Link href="/events/import" className="font-semibold text-primary hover:underline">
          Import it from a file
        </Link>
        .
      </p>
      <EventForm
        mode="create"
        initial={{ registrationOpensAt: null, submissionsOpenAt: null, submissionsCloseAt: null, judgingOpensAt: null, judgingClosesAt: null, maxTeamSize: 4 }}
      />
    </div>
  );
}
