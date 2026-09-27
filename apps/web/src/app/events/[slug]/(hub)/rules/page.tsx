import { Clock, ShieldCheck, Users } from "lucide-react";
import { getEvent } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { HubColumns } from "@/components/HubColumns";
import { Markdown } from "@/components/Markdown";
import { Card } from "@/components/ui";

export const metadata = { title: "Rules" };

export default async function RulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await getEvent(slug);

  return (
    <HubColumns slug={slug}>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: <Users className="size-5" />, title: `Teams of up to ${event.maxTeamSize}`, body: "Solo entries are welcome. Invite teammates with a link." },
          { icon: <Clock className="size-5" />, title: "Hard deadline", body: `Edits lock at ${formatDate(event.submissionsCloseAt)}. The server clock decides.` },
          { icon: <ShieldCheck className="size-5" />, title: "Fair judging", body: "Judges score independently and never see each other's scores." },
        ].map((f) => (
          <div key={f.title} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="mb-3 grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">{f.icon}</div>
            <div className="font-semibold">{f.title}</div>
            <p className="mt-1 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </div>
      <Card title="Official rules">
        {event.rules.trim() ? <Markdown>{event.rules}</Markdown> : <p className="text-sm text-muted">The organizers haven&apos;t published detailed rules yet.</p>}
      </Card>
    </HubColumns>
  );
}
