import Link from "next/link";
import type { GalleryProject } from "@/lib/types";
import { Cover } from "./visuals";

export function ProjectCard({ p, slug }: { p: GalleryProject; slug: string }) {
  return (
    <Link
      href={`/events/${slug}/projects/${p.id}`}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <Cover seed={p.id} src={p.thumbnailUrl} label={p.title} rounded="rounded-none" className="size-full transition duration-300 group-hover:scale-[1.03]" />
        {p.track && (
          <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur">{p.track.name}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-1 text-[17px] font-bold text-ink transition group-hover:text-primary">{p.title}</h3>
        <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted">{p.tagline || "No tagline yet."}</p>
        {p.techTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {p.techTags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 border-t border-line pt-3 text-xs font-semibold text-muted">
          by <span className="text-ink-2">{p.team.name}</span>
        </div>
      </div>
    </Link>
  );
}
