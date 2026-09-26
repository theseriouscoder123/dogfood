import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { EventDetail } from "@/lib/types";
import { formatDate, windowLabel } from "@/lib/format";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<EventDetail>(`/api/events/${encodeURIComponent(slug)}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const { event, tracks, prizes, criteria, myRoles } = data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{event.name}</h1>
        <p className="mt-1 text-zinc-600">{event.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5">{windowLabel[event.submissionWindow]}</span>
          {myRoles.map((r) => (
            <span key={r} className="rounded-full bg-zinc-900 px-2 py-0.5 text-white">
              you: {r}
            </span>
          ))}
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <dl className="rounded-lg border border-zinc-200 bg-white p-5 text-sm">
          <h2 className="mb-3 font-medium">Dates</h2>
          {[
            ["Registration opens", event.registrationOpensAt],
            ["Submissions open", event.submissionsOpenAt],
            ["Submissions close", event.submissionsCloseAt],
            ["Judging opens", event.judgingOpensAt],
            ["Judging closes", event.judgingClosesAt],
          ].map(([label, value = null]) => (
            <div key={label} className="flex justify-between border-b border-zinc-100 py-1.5 last:border-0">
              <dt className="text-zinc-600">{label}</dt>
              <dd>{formatDate(value)}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm">
          <h2 className="mb-3 font-medium">Judging rubric</h2>
          <ul className="space-y-1.5">
            {criteria.map((c) => (
              <li key={c.key} className="flex justify-between">
                <span>{c.label}</span>
                <span className="text-zinc-500">
                  weight {c.weight} · {c.minScore}–{c.maxScore}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-medium">Tracks</h2>
        <ul className="flex flex-wrap gap-2">
          {tracks.map((t) => (
            <li key={t.id}>
              <Link href={`/events/${event.slug}/projects?track=${t.id}`} className="inline-block rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:border-zinc-400">
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {prizes.length > 0 && (
        <section>
          <h2 className="mb-3 font-medium">Prizes</h2>
          <ul className="space-y-2 text-sm">
            {prizes.map((p) => (
              <li key={p.id} className="rounded-md border border-zinc-200 bg-white px-4 py-2">
                <span className="font-medium">{p.name}</span> {p.value && <span className="text-zinc-500">· {p.value}</span>}
                {p.description && <p className="text-zinc-600">{p.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href={`/events/${event.slug}/projects`} className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700">
        Browse the project gallery →
      </Link>
    </div>
  );
}
