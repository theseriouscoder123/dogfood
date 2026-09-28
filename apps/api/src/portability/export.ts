// Writes one event as a dogfood-event/v1 file. Everything is sorted by a stable key, so exporting
// the same event twice gives the same file, and two exports can be diffed.
import type { Event, PrismaClient } from "@prisma/client";
import { config } from "../config";
import { FORMAT, type EventFileInput } from "./format";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const by = <T>(key: (x: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));

export async function exportEvent(prisma: PrismaClient, event: Event): Promise<EventFileInput> {
  const eventId = event.id;
  const [tracks, prizes, criteria, questions, roles, judgeTracks, teams, projects, conflicts, assignments] = await Promise.all([
    prisma.track.findMany({ where: { eventId } }),
    prisma.prize.findMany({ where: { eventId } }),
    prisma.criterion.findMany({ where: { eventId } }),
    prisma.submissionQuestion.findMany({ where: { eventId } }),
    prisma.eventRole.findMany({ where: { eventId }, include: { user: { select: { email: true, name: true } } } }),
    prisma.judgeTrack.findMany({ where: { eventId } }),
    prisma.team.findMany({ where: { eventId }, include: { members: { include: { user: { select: { email: true, name: true } } } } } }),
    prisma.project.findMany({ where: { eventId }, include: { answers: true } }),
    prisma.conflictOfInterest.findMany({ where: { eventId }, include: { judge: { select: { email: true } } } }),
    prisma.assignment.findMany({
      where: { eventId },
      include: { judge: { select: { email: true } }, review: { include: { scores: { include: { criterion: { select: { key: true } } } } } } },
    }),
  ]);

  const trackRef = new Map(tracks.map((t) => [t.id, t.externalId ?? t.id]));
  const teamRef = new Map(teams.map((t) => [t.id, t.externalId ?? t.id]));
  const projectRef = new Map(projects.map((p) => [p.id, p.externalId ?? p.id]));
  const questionRef = new Map(questions.map((q) => [q.id, q.externalId ?? q.id]));

  const people = new Map<string, string>();
  for (const r of roles) people.set(r.user.email, r.user.name);
  for (const t of teams) for (const m of t.members) people.set(m.user.email, m.user.name);
  const emailOf = new Map(roles.map((r) => [r.userId, r.user.email]));

  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    source: { url: config.publicBaseUrl, slug: event.slug },
    event: {
      slug: event.slug,
      name: event.name,
      description: event.description,
      tagline: event.tagline,
      location: event.location,
      overview: event.overview,
      rules: event.rules,
      bannerUrl: event.bannerUrl,
      logoUrl: event.logoUrl,
      timezone: event.timezone,
      registrationOpensAt: iso(event.registrationOpensAt),
      submissionsOpenAt: event.submissionsOpenAt.toISOString(),
      submissionsCloseAt: event.submissionsCloseAt.toISOString(),
      judgingOpensAt: iso(event.judgingOpensAt),
      judgingClosesAt: iso(event.judgingClosesAt),
      maxTeamSize: event.maxTeamSize,
      votingOpensAt: iso(event.votingOpensAt),
      votingClosesAt: iso(event.votingClosesAt),
      votingMode: event.votingMode,
      votesPerVoter: event.votesPerVoter,
      voterDomains: [...event.voterDomains].sort(),
      commentsMode: event.commentsMode,
    },
    people: [...people].map(([email, name]) => ({ email, name })).sort(by((p) => p.email)),
    organizers: roles.filter((r) => r.role === "organizer").map((r) => r.user.email).sort(),
    tracks: tracks.map((t) => ({ ref: trackRef.get(t.id)!, name: t.name, description: t.description })).sort(by((t) => t.ref)),
    prizes: prizes
      .map((p) => ({ name: p.name, description: p.description, value: p.value, rank: p.rank, track: p.trackId ? trackRef.get(p.trackId)! : null }))
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name)),
    criteria: criteria
      .map((c) => ({ key: c.key, label: c.label, description: c.description, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore, position: c.position }))
      .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)),
    questions: questions
      .map((q) => ({ ref: questionRef.get(q.id)!, label: q.label, help: q.help, type: q.type, options: q.options, required: q.required, isPublic: q.isPublic, position: q.position }))
      .sort((a, b) => a.position - b.position || a.ref.localeCompare(b.ref)),
    judges: roles
      .filter((r) => r.role === "judge")
      .map((r) => ({
        person: r.user.email,
        ref: r.externalId,
        tracks: judgeTracks.filter((j) => j.userId === r.userId).map((j) => trackRef.get(j.trackId)!).sort(),
      }))
      .sort(by((j) => j.person)),
    teams: teams
      .map((t) => ({
        ref: teamRef.get(t.id)!,
        name: t.name,
        // captain first, then by email: the importer makes the first member captain-compatible either way
        members: t.members.map((m) => ({ person: m.user.email, role: m.role })).sort((a, b) => (a.role === b.role ? a.person.localeCompare(b.person) : a.role === "captain" ? -1 : 1)),
      }))
      .sort(by((t) => t.ref)),
    projects: projects
      .map((p) => ({
        ref: projectRef.get(p.id)!,
        team: teamRef.get(p.teamId)!,
        track: p.trackId ? trackRef.get(p.trackId)! : null,
        title: p.title,
        tagline: p.tagline,
        description: p.description,
        repoUrl: p.repoUrl,
        demoUrl: p.demoUrl,
        videoUrl: p.videoUrl,
        thumbnailUrl: p.thumbnailUrl,
        techTags: p.techTags,
        status: p.status,
        submittedAt: iso(p.submittedAt),
        duplicateOf: p.duplicateOfId ? projectRef.get(p.duplicateOfId)! : null,
        answers: Object.fromEntries(p.answers.map((a) => [questionRef.get(a.questionId)!, a.value]).sort(by((x) => x[0]!))),
      }))
      .sort(by((p) => p.ref)),
    conflicts: conflicts
      .map((c) => ({ judge: c.judge.email, team: teamRef.get(c.teamId)!, source: c.source, note: c.note }))
      .sort(by((c) => `${c.judge} ${c.team}`)),
    assignments: assignments
      .map((a) => ({
        judge: a.judge.email ?? emailOf.get(a.judgeId)!,
        project: projectRef.get(a.projectId)!,
        status: a.status,
        recusalReason: a.recusalReason,
        review: a.review
          ? {
              status: a.review.status,
              submittedAt: iso(a.review.submittedAt),
              comment: a.review.comment,
              scores: Object.fromEntries(a.review.scores.map((s): [string, number] => [s.criterion.key, s.value]).sort((x, y) => x[0].localeCompare(y[0]))),
            }
          : null,
      }))
      .sort(by((a) => `${a.judge} ${a.project}`)),
  };
}
