import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { EventDetail, Gallery, PublicResults } from "@/lib/types";
import { EmbedGallery } from "./EmbedGallery";

export const metadata = { title: "Gallery", robots: { index: false } };

type Search = { theme?: string; track?: string; search?: string; winners?: string };

/**
 * The embeddable gallery (framed by embed.js or a plain iframe). It's always rendered as an
 * anonymous visitor, so a signed-in organizer viewing a third-party page never leaks drafts into
 * it, and it has no actions that clickjacking could abuse. That's why this is the one route that
 * other sites may frame (next.config.ts).
 */
export default async function EmbedPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const q = await searchParams;
  const e = encodeURIComponent(slug);
  const [detail, gallery, results] = await Promise.all([
    api<EventDetail>(`/api/events/${e}`, { anonymous: true }).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) notFound();
      throw err;
    }),
    api<Gallery>(`/api/events/${e}/projects`, { anonymous: true }),
    api<PublicResults>(`/api/events/${e}/results`, { anonymous: true }).catch(() => null),
  ]);
  const theme = q.theme === "dark" || q.theme === "light" ? q.theme : null;
  const rank = Object.fromEntries((results?.results ?? []).filter((r) => r.rank <= 3).map((r) => [r.project.id, r.rank]));

  return (
    <>
      {/* The root layout renders embeds bare (see middleware.ts); the theme comes from the embed, not the visitor's portal setting. */}
      <style>{`body { background: var(--bg) }`}</style>
      {theme && <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)}` }} />}
      <EmbedGallery
        slug={slug}
        eventName={detail.event.name}
        tracks={detail.tracks.map((t) => ({ id: t.id, externalId: t.externalId, name: t.name }))}
        projects={gallery.projects}
        ranks={q.winners === "0" ? {} : rank}
        initialTrack={q.track ?? null}
        showSearch={q.search !== "0"}
      />
    </>
  );
}
