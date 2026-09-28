import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import { HubColumns } from "@/components/HubColumns";
import { TeamFinder, type FinderData } from "./TeamFinder";

export const metadata = { title: "Find a team" };

export default async function TeamFinderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [data, me] = await Promise.all([api<FinderData>(`/api/events/${encodeURIComponent(slug)}/team-finder`), getMe()]);
  return (
    <HubColumns slug={slug}>
      <TeamFinder slug={slug} data={data} signedIn={!!me.user} />
    </HubColumns>
  );
}
