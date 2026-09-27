import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import { OrganizersEditor } from "../editors";

export default async function OrganizersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [me, { organizers }] = await Promise.all([
    getMe(),
    api<{ organizers: Array<{ id: string; name: string; email: string }> }>(`/api/events/${encodeURIComponent(slug)}/organizers`),
  ]);
  return (
    <div>
      <h1 className="mb-6 text-3xl font-extrabold">Organizers</h1>
      <OrganizersEditor slug={slug} organizers={organizers} meId={me.user?.id ?? ""} />
    </div>
  );
}
