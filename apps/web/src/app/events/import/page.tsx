import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getMe } from "@/lib/session";
import { EmptyState } from "@/components/ui";
import { ImportWizard } from "./ImportWizard";

export const metadata = { title: "Import an event" };

export default async function ImportPage() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/events/import");
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      {!me.user.isAdmin ? (
        <EmptyState icon={<ShieldAlert className="size-5" />} title="Only admins can import events" />
      ) : (
        <>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Import an event</h1>
          <p className="mb-8 mt-2 text-muted">
            A Verdict event file (Exports → Full event) or a DOGFOOD <code className="font-mono text-sm">fixtures.json</code>. Prefer a blank start?{" "}
            <Link href="/events/new" className="font-semibold text-primary hover:underline">
              Create an event
            </Link>
            .
          </p>
          <ImportWizard />
        </>
      )}
    </div>
  );
}
