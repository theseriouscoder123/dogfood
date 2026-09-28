import { getEvent } from "@/lib/data";
import { EmbedBuilder } from "./EmbedBuilder";

export const metadata = { title: "Embed" };

export default async function EmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getEvent(slug);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Embed the gallery</h1>
        <p className="max-w-3xl text-sm text-muted">
          Show your projects on your own site, sponsor pages or a university blog. The widget is read-only and always shows exactly what the public gallery shows, so it can&apos;t
          leak drafts, even when an organizer is the one looking at it.
        </p>
      </div>
      <EmbedBuilder slug={slug} tracks={detail.tracks.map((t) => ({ id: t.id, name: t.name }))} resultsPublished={detail.event.resultsPublished} />
    </div>
  );
}
