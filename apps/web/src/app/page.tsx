import Link from "next/link";
import { api } from "@/lib/api";
import type { EventSummary } from "@/lib/types";
import { formatDate, windowLabel } from "@/lib/format";

export default async function HomePage() {
  const { events } = await api<{ events: EventSummary[] }>("/api/events");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Events</h1>
      {events.length === 0 && <p className="text-zinc-600">No events yet.</p>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {events.map((e) => (
          <li key={e.slug} className="rounded-lg border border-zinc-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/events/${e.slug}`} className="text-lg font-medium hover:underline">
                {e.name}
              </Link>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">{windowLabel[e.submissionWindow]}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-600">{e.description}</p>
            <p className="mt-3 text-xs text-zinc-500">Submissions close {formatDate(e.submissionsCloseAt)}</p>
            <Link href={`/events/${e.slug}/projects`} className="mt-3 inline-block text-sm font-medium text-zinc-900 hover:underline">
              {e.projectCount} projects →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
