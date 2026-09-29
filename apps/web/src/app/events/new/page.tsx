import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { CreateWizard } from "./CreateWizard";

export const metadata = { title: "Host a hackathon" };

export default async function NewEventPage() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/events/new");

  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Host a hackathon</h1>
      <p className="mb-8 mt-2 text-muted">
        Moving from another Verdict install?{" "}
        <Link href="/events/import" className="font-semibold text-primary hover:underline">
          Import it from a file
        </Link>
        .
      </p>
      <CreateWizard />
    </div>
  );
}
