import { api } from "@/lib/api";
import type { EventSummary } from "@/lib/types";
import { HackathonBrowser } from "@/components/HackathonBrowser";

export const metadata = { title: "Hackathons" };

export default async function HackathonsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = "all", q = "" } = await searchParams;
  const { events } = await api<{ events: EventSummary[] }>("/api/events");
  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
      <h1 className="mb-6 text-3xl font-extrabold sm:text-4xl">Hackathons</h1>
      <HackathonBrowser events={events} status={status} q={q} path="/hackathons" />
    </div>
  );
}
