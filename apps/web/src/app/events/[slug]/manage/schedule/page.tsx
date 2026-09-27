import { getEvent } from "@/lib/data";
import { EventForm } from "@/components/EventForm";

export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await getEvent(slug);
  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">Schedule</h1>
      <p className="mb-6 text-sm text-muted">All times are in UTC. The server enforces every one of these dates.</p>
      <EventForm mode="schedule" slug={slug} initial={event} />
    </div>
  );
}
