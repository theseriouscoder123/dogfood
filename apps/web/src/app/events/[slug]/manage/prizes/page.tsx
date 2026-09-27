import { getEvent } from "@/lib/data";
import { PrizesEditor } from "../editors";

export default async function PrizesManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { prizes, tracks } = await getEvent(slug);
  return (
    <div>
      <h1 className="mb-6 text-3xl font-extrabold">Prizes</h1>
      <PrizesEditor slug={slug} prizes={prizes} tracks={tracks} />
    </div>
  );
}
