// Public gallery. Server-rendered so project titles are in the HTML itself:
// search engines, no-JS visitors and plain HTTP clients all see the real content.
import { Layers, Search, X } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { getEvent } from "@/lib/data";
import type { Gallery } from "@/lib/types";
import { ProjectCard } from "@/components/ProjectCard";
import { Chip, EmptyState, inputClass } from "@/components/ui";

export const metadata = { title: "Projects" };

type Search = { q?: string; track?: string };

export default async function GalleryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const { q = "", track = "" } = await searchParams;
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (track) qs.set("track", track);

  const [gallery, detail] = await Promise.all([api<Gallery>(`/api/events/${encodeURIComponent(slug)}/projects?${qs}`), getEvent(slug)]);
  const base = `/events/${slug}/projects`;
  const link = (t: string) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (t) u.set("track", t);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  const activeTrack = detail.tracks.find((t) => t.id === track || t.externalId === track);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold">Project gallery</h2>
          <p className="text-sm text-muted">
            {gallery.total} project{gallery.total === 1 ? "" : "s"}
            {activeTrack && (
              <>
                {" "}
                in <span className="font-semibold text-ink">{activeTrack.name}</span>
              </>
            )}
            {q && (
              <>
                {" "}
                matching <span className="font-semibold text-ink">&ldquo;{q}&rdquo;</span>
              </>
            )}
          </p>
        </div>
        <form method="get" className="relative w-full sm:w-80">
          {track && <input type="hidden" name="track" value={track} />}
          <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search projects, teams, tech" className={`${inputClass} pl-10`} />
        </form>
      </div>

      {detail.tracks.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Chip href={link("")} active={!track}>
            All tracks
          </Chip>
          {detail.tracks.map((t) => (
            <Chip key={t.id} href={link(t.id)} active={activeTrack?.id === t.id}>
              {t.name}
              {t.projectCount !== undefined && <span className="text-[11px] opacity-60">{t.projectCount}</span>}
            </Chip>
          ))}
        </div>
      )}

      {gallery.projects.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-5" />}
          title={q || track ? "No projects match" : "No projects yet"}
          action={
            (q || track) && (
              <Link href={base} className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
                <X className="size-4" /> Clear filters
              </Link>
            )
          }
        >
          {q || track ? "Try a different search or track." : "Submitted projects will appear here."}
        </EmptyState>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {gallery.projects.map((p) => (
            <li key={p.id} className="flex">
              <div className="flex w-full">
                <ProjectCard p={p} slug={slug} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
