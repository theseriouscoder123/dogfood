"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Medal, Search } from "lucide-react";
import type { GalleryProject } from "@/lib/types";
import { Cover, LogoMark } from "@/components/visuals";

type Props = {
  slug: string;
  eventName: string;
  tracks: Array<{ id: string; externalId: string | null; name: string }>;
  projects: GalleryProject[];
  ranks: Record<string, number>;
  initialTrack: string | null;
  showSearch: boolean;
};

const MEDAL = ["", "bg-[#e8b923] text-[#3b2a00]", "bg-[#c7cfd9] text-[#1f2933]", "bg-[#d98a4e] text-[#2e1500]"];

export function EmbedGallery({ slug, eventName, tracks, projects, ranks, initialTrack, showSearch }: Props) {
  const [q, setQ] = useState("");
  const start = tracks.find((t) => t.id === initialTrack || t.externalId === initialTrack)?.id ?? null;
  const [track, setTrack] = useState<string | null>(start);
  const root = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => !track || p.track?.id === track)
      .filter((p) => !needle || [p.title, p.tagline, p.team.name, ...p.techTags].some((s) => s.toLowerCase().includes(needle)))
      .sort((a, b) => (ranks[a.id] ?? 99) - (ranks[b.id] ?? 99) || a.title.localeCompare(b.title));
  }, [projects, q, track, ranks]);

  // Tell the host page how tall we are, so embed.js can size the iframe with no inner scrollbar.
  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return;
    const post = () => window.parent.postMessage({ type: "dogfood:embed-height", slug, height: Math.ceil(el.getBoundingClientRect().height) }, "*");
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [slug]);

  const home = `/events/${slug}`;
  return (
    <div ref={root} className="bg-bg p-3 text-ink sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <a href={home} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-display text-lg font-extrabold hover:text-primary">
          {eventName} <span className="text-sm font-semibold text-muted">· {projects.length} projects</span>
        </a>
        {showSearch && (
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search projects</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search projects"
              className="w-full rounded-[10px] border border-line bg-surface py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
            />
          </label>
        )}
      </div>
      {tracks.length > 1 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {[{ id: null as string | null, name: "All" }, ...tracks].map((t) => (
            <button
              key={t.id ?? "all"}
              type="button"
              onClick={() => setTrack(t.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition ${track === t.id ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">No projects match.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
          {shown.map((p) => (
            <li key={p.id}>
              <a
                href={`/events/${slug}/projects/${p.id}`}
                target="_blank"
                rel="noopener"
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <Cover seed={p.id} src={p.thumbnailUrl} label={p.title} rounded="rounded-none" className="size-full" />
                  {ranks[p.id] && (
                    <span className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold shadow ${MEDAL[ranks[p.id]!]}`}>
                      <Medal className="size-3" /> {ranks[p.id] === 1 ? "1st" : ranks[p.id] === 2 ? "2nd" : "3rd"}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="line-clamp-1 font-bold group-hover:text-primary">{p.title}</h3>
                  <p className="mt-0.5 line-clamp-2 flex-1 text-xs text-muted">{p.tagline || "No tagline yet."}</p>
                  <p className="mt-2 truncate text-[11px] font-semibold text-muted">
                    {p.team.name}
                    {p.track && ` · ${p.track.name}`}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      <a href={home} target="_blank" rel="noopener" className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted hover:text-ink">
        <LogoMark size={14} /> Hosted on Verdict <ArrowUpRight className="size-3" />
      </a>
    </div>
  );
}
