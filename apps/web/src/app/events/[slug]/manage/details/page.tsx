import { getEvent } from "@/lib/data";
import { DetailsForm } from "../editors";

export default async function DetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await getEvent(slug);
  return (
    <div>
      <h1 className="mb-6 text-3xl font-extrabold">Details &amp; branding</h1>
      <DetailsForm slug={slug} event={event} />
    </div>
  );
}
