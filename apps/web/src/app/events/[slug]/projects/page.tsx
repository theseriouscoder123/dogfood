// Public gallery. Rendered on the server so project titles are in the HTML itself:
// search engines, no-JS visitors and plain HTTP clients all see the real content.
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { EventDetail, Gallery } from "@/lib/types";

type Search = { q?: string; track?: string };

export default async function GalleryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const { q = "", track = "" } = await searchParams;
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (track) qs.set("track", track);

  const [gallery, detail] = await Promise.all([
    api<Gallery>(`/api/events/${encodeURIComponent(slug)}/projects?${qs}`),
    api<EventDetail>(`/api/events/${encodeURIComponent(slug)}`),
  ]).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/events/${slug}`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← {gallery.event.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Projects</h1>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search title, tagline or tag"
          className="min-w-64 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <select name="track" defaultValue={track} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
          <option value="">All tracks</option>
          {detail.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700">
          Filter
        </button>
      </form>

      <p className="text-sm text-zinc-500">
        {gallery.total} project{gallery.total === 1 ? "" : "s"}
      </p>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gallery.projects.map((p) => (
          <li key={p.id} className="flex flex-col rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="font-medium">{p.title}</h2>
            <p className="mt-1 flex-1 text-sm text-zinc-600">{p.tagline}</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {p.track && <span className="rounded-full bg-zinc-100 px-2 py-0.5">{p.track.name}</span>}
              {p.techTags.map((t) => (
                <span key={t} className="rounded-full border border-zinc-200 px-2 py-0.5">
                  {t}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>by {p.team.name}</span>
              {p.repoUrl && (
                <a href={p.repoUrl} rel="noopener noreferrer" target="_blank" className="hover:text-zinc-900">
                  repo ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
