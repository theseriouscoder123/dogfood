// Organizer alerts that no single change triggers, so the worker looks for them once a minute:
//   - a judge has fallen behind (the same rule the progress dashboard uses), and
//   - community voting has a high-severity incident nobody has decided on yet.
// Each alert has a unique key per (thing, organizer), so it goes out once however often this runs.
import { prisma } from "../db";
import { judgingWindow, votingWindow } from "../policy";
import { assessJudge, elapsedFraction } from "../judging/progress";
import { detectSignals, groupIncidents } from "../voting/abuse";
import { loadAbuseBallots } from "../routes/voting";
import { notify, type Note } from "./notify";

const organizersOf = async (eventId: string) =>
  (await prisma.eventRole.findMany({ where: { eventId, role: "organizer" }, select: { userId: true }, distinct: ["userId"] })).map((r) => r.userId);

/** Judges who are stragglers while judging is still open (a missed deadline is on the dashboard already). */
export async function watchJudges(now = new Date()): Promise<number> {
  const events = await prisma.event.findMany({
    where: { publishedAt: { not: null }, judgingClosesAt: { gt: now } },
    select: { id: true, slug: true, name: true, submissionsCloseAt: true, judgingOpensAt: true, judgingClosesAt: true },
  });
  let sent = 0;
  for (const e of events) {
    if (judgingWindow(e, now) !== "open") continue;
    const elapsed = elapsedFraction(e.judgingOpensAt ?? e.submissionsCloseAt, e.judgingClosesAt, now);
    const assignments = await prisma.assignment.findMany({
      where: { eventId: e.id, project: { status: "submitted", duplicateOfId: null } },
      select: { judgeId: true, status: true, openedAt: true, review: { select: { id: true } }, judge: { select: { name: true } } },
    });
    const byJudge = new Map<string, typeof assignments>();
    for (const a of assignments) byJudge.set(a.judgeId, [...(byJudge.get(a.judgeId) ?? []), a]);
    const behind: Array<{ id: string; name: string; left: number; notStarted: boolean }> = [];
    for (const [judgeId, list] of byJudge) {
      const active = list.filter((a) => a.status !== "recused").length;
      const submitted = list.filter((a) => a.status === "submitted").length;
      const started = list.some((a) => a.openedAt !== null || a.review !== null);
      const { pace, straggler } = assessJudge({ active, submitted, started }, "open", elapsed);
      if (straggler) behind.push({ id: judgeId, name: list[0]!.judge.name, left: active - submitted, notStarted: pace === "not_started" });
    }
    if (!behind.length) continue;
    const organizers = await organizersOf(e.id);
    const notes: Note[] = behind.flatMap((j) =>
      organizers.map((userId) => ({
        userId,
        eventId: e.id,
        category: "organizer" as const,
        title: j.notStarted ? `${j.name} hasn't started judging` : `${j.name} is falling behind on judging`,
        body: `${j.left} review${j.left === 1 ? "" : "s"} left · ${e.name}`,
        url: `/events/${e.slug}/manage/progress`,
        key: `behind:${e.id}:${j.id}:${userId}`,
      })),
    );
    sent += await notify(prisma, notes);
  }
  return sent;
}

/** High-severity vote incidents without an organizer decision, while voting is open. */
export async function watchVoting(now = new Date()): Promise<number> {
  const events = await prisma.event.findMany({
    where: { publishedAt: { not: null }, votingOpensAt: { lte: now } },
    select: { id: true, slug: true, name: true, votingOpensAt: true, votingClosesAt: true },
  });
  let sent = 0;
  for (const e of events) {
    if (votingWindow(e, now) !== "open") continue;
    const incidents = groupIncidents(detectSignals((await loadAbuseBallots(e.id)).map((l) => l.input))).filter((i) => i.severity === "high");
    if (!incidents.length) continue;
    const decided = new Set(
      (await prisma.integrityResolution.findMany({ where: { eventId: e.id, flagKey: { in: incidents.map((i) => `vote:${i.key}`) } }, select: { flagKey: true } })).map((r) => r.flagKey.slice(5)),
    );
    const open = incidents.filter((i) => !decided.has(i.key));
    if (!open.length) continue;
    const organizers = await organizersOf(e.id);
    sent += await notify(
      prisma,
      open.flatMap((i) =>
        organizers.map((userId) => ({
          userId,
          eventId: e.id,
          category: "organizer" as const,
          title: "Suspicious voting needs a look",
          body: `${i.ballotIds.length} ballot${i.ballotIds.length === 1 ? "" : "s"}, ${i.signals.length} signals · ${e.name}`,
          url: `/events/${e.slug}/manage/vote-review`,
          key: `incident:${e.id}:${i.key}:${userId}`,
        })),
      ),
    );
  }
  return sent;
}
