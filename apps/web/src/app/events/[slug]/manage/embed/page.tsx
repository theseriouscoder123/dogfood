import { getEvent } from "@/lib/data";
import { EmbedBuilder } from "./EmbedBuilder";

export const metadata = { title: "Embed" };

export default async function EmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getEvent(slug);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Embed</h1>
        <p className="max-w-3xl text-sm text-muted">Show your projects on any website.</p>
      </div>
      <EmbedBuilder slug={slug} tracks={detail.tracks.map((t) => ({ id: t.id, name: t.name }))} resultsPublished={detail.event.resultsPublished} />
    </div>
  );
}
