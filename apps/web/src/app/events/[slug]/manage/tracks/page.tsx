import { getEvent } from "@/lib/data";
import { TracksEditor } from "../editors";

export default async function TracksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { tracks } = await getEvent(slug);
  return (
    <div>
      <h1 className="mb-6 text-3xl font-extrabold">Tracks</h1>
      <TracksEditor slug={slug} tracks={tracks} />
    </div>
  );
}
