import { api } from "@/lib/api";
import { getEvent } from "@/lib/data";
import type { ConflictRow, JudgeRow, TeamRow } from "@/lib/types";
import { JudgesManager } from "./JudgesManager";

export default async function JudgesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = encodeURIComponent(slug);
  const [{ tracks }, { judges }, { teams }, { conflicts }] = await Promise.all([
    getEvent(slug),
    api<{ judges: JudgeRow[] }>(`/api/events/${s}/judges`),
    api<{ teams: TeamRow[] }>(`/api/events/${s}/teams`),
    api<{ conflicts: ConflictRow[] }>(`/api/events/${s}/conflicts`),
  ]);
  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">Judges</h1>
      <p className="mb-6 text-sm text-muted">Invite your panel, decide which tracks each judge covers, and record conflicts of interest.</p>
      <JudgesManager slug={slug} judges={judges} tracks={tracks} teams={teams} conflicts={conflicts} />
    </div>
  );
}
