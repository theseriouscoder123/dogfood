// Reads a dogfood-event/v1 file (or a DOGFOOD fixture file, through fixtureToEventFile) into a new
// event. All or nothing: every reference is checked first and every problem is reported at once;
// then the whole event is written in one transaction.
//
// A dry run is the real import, rolled back at the end, so the preview can't disagree with what
// importing would actually do.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { appendAudit, type AuditEntry } from "../audit";
import { detectDuplicates } from "../seed/duplicates";
import { nameFromEmail, slugify, titleCase, type FixtureFile } from "../seed/importFixtures";
import { FORMAT, type EventFile, type EventFileInput } from "./format";

const RESERVED_SLUGS = new Set(["new", "import"]);
const HOUR = 3_600_000;

export class ImportProblems extends Error {
  constructor(public readonly problems: string[]) {
    super(`${problems.length} problem${problems.length === 1 ? "" : "s"} in the file`);
  }
}

export type ImportCounts = {
  people: number; newAccounts: number; tracks: number; prizes: number; criteria: number; questions: number;
  judges: number; teams: number; projects: number; conflicts: number; assignments: number; reviews: number;
};
export type ImportResult = { dryRun: boolean; event: { id: string; slug: string; name: string }; counts: ImportCounts };

class DryRun extends Error {
  constructor(public readonly result: ImportResult) {
    super("dry run");
  }
}

/** Every broken reference or impossible value, in plain words. Empty means the file can be imported. */
export function checkEventFile(f: EventFile, slug: string): string[] {
  const p: string[] = [];
  const dupes = (xs: string[], what: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (seen.has(x)) p.push(`${what} "${x}" appears twice.`);
      seen.add(x);
    }
    return seen;
  };
  if (RESERVED_SLUGS.has(slug)) p.push(`"${slug}" is reserved; choose another slug.`);
  const e = f.event;
  const before = (a: string | null, b: string | null) => !a || !b || new Date(a) < new Date(b);
  if (!before(e.submissionsOpenAt, e.submissionsCloseAt)) p.push("Submissions must open before they close.");
  if (!before(e.judgingOpensAt, e.judgingClosesAt)) p.push("Judging must open before it closes.");
  if (!before(e.votingOpensAt, e.votingClosesAt)) p.push("Voting must open before it closes.");

  const people = dupes(f.people.map((x) => x.email), "Person");
  const person = (email: string, where: string) => {
    if (!people.has(email)) p.push(`${where} refers to ${email}, who isn't in "people".`);
  };
  const tracks = dupes(f.tracks.map((t) => t.ref), "Track");
  const teams = dupes(f.teams.map((t) => t.ref), "Team");
  const projects = dupes(f.projects.map((x) => x.ref), "Project");
  const questions = dupes(f.questions.map((q) => q.ref), "Question");
  const criteria = new Map(f.criteria.map((c) => [c.key, c]));
  dupes(f.criteria.map((c) => c.key), "Criterion");
  for (const c of f.criteria) if (c.minScore >= c.maxScore) p.push(`Criterion "${c.key}": minScore must be below maxScore.`);

  for (const o of f.organizers) person(o, "An organizer");
  const judges = dupes(f.judges.map((j) => j.person), "Judge");
  for (const j of f.judges) {
    person(j.person, `Judge ${j.person}`);
    for (const t of j.tracks) if (!tracks.has(t)) p.push(`Judge ${j.person} covers unknown track "${t}".`);
  }
  dupes(f.judges.flatMap((j) => (j.ref ? [j.ref] : [])), "Judge ref");
  for (const pr of f.prizes) if (pr.track && !tracks.has(pr.track)) p.push(`Prize "${pr.name}" is in unknown track "${pr.track}".`);

  const onTeam = new Map<string, string>();
  for (const t of f.teams) {
    for (const m of t.members) {
      person(m.person, `Team "${t.ref}"`);
      if (onTeam.has(m.person)) p.push(`${m.person} is on two teams ("${onTeam.get(m.person)}" and "${t.ref}"); one team per person.`);
      onTeam.set(m.person, t.ref);
    }
  }
  for (const x of f.projects) {
    if (!teams.has(x.team)) p.push(`Project "${x.ref}" belongs to unknown team "${x.team}".`);
    if (x.track && !tracks.has(x.track)) p.push(`Project "${x.ref}" is in unknown track "${x.track}".`);
    if (x.duplicateOf && (!projects.has(x.duplicateOf) || x.duplicateOf === x.ref)) p.push(`Project "${x.ref}" duplicates unknown project "${x.duplicateOf}".`);
    for (const q of Object.keys(x.answers)) if (!questions.has(q)) p.push(`Project "${x.ref}" answers unknown question "${q}".`);
  }
  for (const c of f.conflicts) {
    if (!judges.has(c.judge)) p.push(`Conflict: ${c.judge} isn't a judge.`);
    if (!teams.has(c.team)) p.push(`Conflict: unknown team "${c.team}".`);
  }
  const pairs = new Set<string>();
  for (const a of f.assignments) {
    const where = `Assignment ${a.judge} → "${a.project}"`;
    if (!judges.has(a.judge)) p.push(`${where}: ${a.judge} isn't a judge.`);
    if (!projects.has(a.project)) p.push(`${where}: unknown project.`);
    if (pairs.has(`${a.judge} ${a.project}`)) p.push(`${where} appears twice.`);
    pairs.add(`${a.judge} ${a.project}`);
    for (const [key, v] of Object.entries(a.review?.scores ?? {})) {
      const c = criteria.get(key);
      if (!c) p.push(`${where}: score for unknown criterion "${key}".`);
      else if (v < c.minScore || v > c.maxScore) p.push(`${where}: ${key} = ${v} is outside ${c.minScore}–${c.maxScore}.`);
    }
  }
  return p;
}

export async function importEvent(
  prisma: PrismaClient,
  f: EventFile,
  opts: { slug?: string; dryRun: boolean; audit: Omit<AuditEntry, "action" | "entityType"> },
): Promise<ImportResult> {
  const slug = opts.slug ?? f.event.slug;
  const problems = checkEventFile(f, slug);
  if (await prisma.event.findUnique({ where: { slug }, select: { id: true } })) problems.unshift(`An event with the slug "${slug}" already exists; import it under another slug.`);
  if (problems.length) throw new ImportProblems(problems);

  try {
    return await prisma.$transaction((tx) => write(tx, f, slug, opts), { timeout: 120_000, maxWait: 10_000 });
  } catch (err) {
    if (err instanceof DryRun) return err.result;
    throw err;
  }
}

async function write(tx: Prisma.TransactionClient, f: EventFile, slug: string, opts: { dryRun: boolean; audit: Omit<AuditEntry, "action" | "entityType"> }): Promise<ImportResult> {
  const d = (s: string | null) => (s ? new Date(s) : null);
  const e = f.event;
  const event = await tx.event.create({
    data: {
      slug, name: e.name, description: e.description, tagline: e.tagline, location: e.location, overview: e.overview, rules: e.rules,
      bannerUrl: e.bannerUrl, logoUrl: e.logoUrl, timezone: e.timezone,
      registrationOpensAt: d(e.registrationOpensAt), submissionsOpenAt: new Date(e.submissionsOpenAt), submissionsCloseAt: new Date(e.submissionsCloseAt),
      judgingOpensAt: d(e.judgingOpensAt), judgingClosesAt: d(e.judgingClosesAt), maxTeamSize: e.maxTeamSize,
      votingOpensAt: d(e.votingOpensAt), votingClosesAt: d(e.votingClosesAt), votingMode: e.votingMode, votesPerVoter: e.votesPerVoter,
      voterDomains: e.voterDomains, commentsMode: e.commentsMode,
    },
  });
  const eventId = event.id;

  // People: someone already on this install (same email) is reused, never renamed. New accounts
  // have no password; the person claims theirs by registering with that email.
  const known = await tx.user.findMany({ where: { email: { in: f.people.map((p) => p.email) } }, select: { id: true, email: true } });
  const userId = new Map(known.map((u) => [u.email, u.id]));
  const fresh = f.people.filter((p) => !userId.has(p.email)).map((p) => ({ id: randomUUID(), email: p.email, name: p.name, passwordHash: null }));
  for (const u of fresh) userId.set(u.email, u.id);
  await tx.user.createMany({ data: fresh });
  const uid = (email: string) => userId.get(email)!;

  const trackId = new Map(f.tracks.map((t) => [t.ref, randomUUID()]));
  await tx.track.createMany({ data: f.tracks.map((t) => ({ id: trackId.get(t.ref)!, eventId, externalId: t.ref, name: t.name, description: t.description })) });
  await tx.prize.createMany({ data: f.prizes.map((p) => ({ eventId, name: p.name, description: p.description, value: p.value, rank: p.rank, trackId: p.track ? trackId.get(p.track)! : null })) });
  const criterionId = new Map(f.criteria.map((c) => [c.key, randomUUID()]));
  await tx.criterion.createMany({ data: f.criteria.map((c) => ({ id: criterionId.get(c.key)!, eventId, key: c.key, label: c.label, description: c.description, weight: c.weight, minScore: c.minScore, maxScore: c.maxScore, position: c.position })) });
  const questionId = new Map(f.questions.map((q) => [q.ref, randomUUID()]));
  await tx.submissionQuestion.createMany({
    data: f.questions.map((q) => ({ id: questionId.get(q.ref)!, eventId, externalId: q.ref, label: q.label, help: q.help, type: q.type, options: q.options, required: q.required, isPublic: q.isPublic, position: q.position })),
  });

  // Roles. Whoever imports the event organizes it too, so it's never left without an organizer.
  const organizers = new Set(f.organizers.map(uid));
  if (opts.audit.actor) organizers.add(opts.audit.actor.id);
  await tx.eventRole.createMany({
    data: [
      ...[...organizers].map((userId) => ({ eventId, userId, role: "organizer" as const })),
      ...f.judges.map((j) => ({ eventId, userId: uid(j.person), role: "judge" as const, externalId: j.ref })),
      ...f.teams.flatMap((t) => t.members.map((m) => ({ eventId, userId: uid(m.person), role: "participant" as const }))),
    ],
    skipDuplicates: true,
  });
  await tx.judgeTrack.createMany({ data: f.judges.flatMap((j) => j.tracks.map((t) => ({ eventId, userId: uid(j.person), trackId: trackId.get(t)! }))) });

  const teamId = new Map(f.teams.map((t) => [t.ref, randomUUID()]));
  await tx.team.createMany({ data: f.teams.map((t) => ({ id: teamId.get(t.ref)!, eventId, externalId: t.ref, name: t.name })) });
  await tx.teamMember.createMany({ data: f.teams.flatMap((t) => t.members.map((m) => ({ teamId: teamId.get(t.ref)!, eventId, userId: uid(m.person), role: m.role }))) });

  const projectId = new Map(f.projects.map((p) => [p.ref, randomUUID()]));
  await tx.project.createMany({
    data: f.projects.map((p) => ({
      id: projectId.get(p.ref)!, eventId, externalId: p.ref, teamId: teamId.get(p.team)!, trackId: p.track ? trackId.get(p.track)! : null,
      title: p.title, tagline: p.tagline, description: p.description, repoUrl: p.repoUrl, demoUrl: p.demoUrl, videoUrl: p.videoUrl, thumbnailUrl: p.thumbnailUrl,
      techTags: p.techTags, status: p.status, submittedAt: d(p.submittedAt),
      // In the same statement: "one live project per team" only holds once the duplicate is marked,
      // and the foreign key is checked at the end of the statement, whatever order the file uses.
      duplicateOfId: p.duplicateOf ? projectId.get(p.duplicateOf)! : null,
    })),
  });
  await tx.projectAnswer.createMany({ data: f.projects.flatMap((p) => Object.entries(p.answers).map(([q, value]) => ({ projectId: projectId.get(p.ref)!, questionId: questionId.get(q)!, value }))) });
  await tx.conflictOfInterest.createMany({ data: f.conflicts.map((c) => ({ eventId, judgeId: uid(c.judge), teamId: teamId.get(c.team)!, source: c.source, note: c.note })) });

  const batch = await tx.assignmentBatch.create({ data: { eventId, name: "Imported with the event", algorithm: "import", params: { format: FORMAT } } });
  const assignments = [], reviews = [], scores = [];
  for (const a of f.assignments) {
    const id = randomUUID();
    const judgeId = uid(a.judge), pid = projectId.get(a.project)!;
    assignments.push({ id, eventId, batchId: batch.id, judgeId, projectId: pid, status: a.status, recusalReason: a.recusalReason });
    if (!a.review) continue;
    const reviewId = randomUUID();
    reviews.push({ id: reviewId, assignmentId: id, eventId, judgeId, projectId: pid, status: a.review.status, submittedAt: d(a.review.submittedAt), comment: a.review.comment });
    for (const [key, value] of Object.entries(a.review.scores)) scores.push({ reviewId, criterionId: criterionId.get(key)!, value });
  }
  await tx.assignment.createMany({ data: assignments });
  await tx.review.createMany({ data: reviews });
  await tx.reviewScore.createMany({ data: scores });

  const counts: ImportCounts = {
    people: f.people.length, newAccounts: fresh.length, tracks: f.tracks.length, prizes: f.prizes.length, criteria: f.criteria.length, questions: f.questions.length,
    judges: f.judges.length, teams: f.teams.length, projects: f.projects.length, conflicts: f.conflicts.length, assignments: assignments.length, reviews: reviews.length,
  };
  const result: ImportResult = { dryRun: opts.dryRun, event: { id: eventId, slug, name: event.name }, counts };
  await appendAudit(tx, { ...opts.audit, eventId, action: "event.imported", entityType: "Event", entityId: eventId, after: { ...counts, source: f.source ?? null } });
  if (opts.dryRun) throw new DryRun(result);
  return result;
}

/**
 * The DOGFOOD fixture format, as a dogfood-event/v1 file. Derivations match the seed importer
 * (importFixtures) exactly; tests/integration/portability.test.ts checks the two give identical events.
 */
export function fixtureToEventFile(fx: FixtureFile): EventFileInput {
  const close = new Date(fx.event.submissions_close);
  const at = (ms: number) => new Date(close.getTime() + ms).toISOString();
  const names = new Map<string, string>();
  for (const j of fx.judges) names.set(j.email.toLowerCase(), j.name);
  for (const t of fx.teams) for (const m of t.members) if (!names.has(m.toLowerCase())) names.set(m.toLowerCase(), nameFromEmail(m.toLowerCase()));
  const judgeEmail = new Map(fx.judges.map((j) => [j.id, j.email.toLowerCase()]));
  const keys = [...new Set(fx.scores.flatMap((s) => Object.keys(s.criteria)))];
  const judgeEmails = new Set(judgeEmail.values());

  return {
    format: FORMAT,
    event: {
      slug: slugify(fx.event.name), name: fx.event.name, description: "Imported from fixtures.json.",
      registrationOpensAt: at(-30 * 24 * HOUR), submissionsOpenAt: at(-72 * HOUR), submissionsCloseAt: close.toISOString(),
      judgingOpensAt: close.toISOString(), judgingClosesAt: at(10 * 24 * HOUR),
    },
    people: [...names].map(([email, name]) => ({ email, name })),
    tracks: fx.tracks.map((t) => ({ ref: t.id, name: t.name })),
    criteria: keys.map((key, position) => ({ key, label: titleCase(key), position })),
    judges: fx.judges.map((j) => ({ person: j.email.toLowerCase(), ref: j.id, tracks: j.tracks })),
    teams: fx.teams.map((t) => ({ ref: t.id, name: t.name, members: t.members.map((m, i) => ({ person: m.toLowerCase(), role: i === 0 ? ("captain" as const) : ("member" as const) })) })),
    projects: detectDuplicates(fx.projects).map(({ project: p, duplicateOf }) => ({
      ref: p.id, team: p.team, track: p.track, title: p.title, tagline: p.summary, repoUrl: p.repo_url ?? null, status: "submitted" as const, submittedAt: p.submitted_at, duplicateOf: duplicateOf ?? null,
    })),
    conflicts: fx.teams.flatMap((t) => t.members.filter((m) => judgeEmails.has(m.toLowerCase())).map((m) => ({ judge: m.toLowerCase(), team: t.id, source: "detected" as const, note: "judge is a member of this team" }))),
    assignments: fx.scores.map((s) => ({ judge: judgeEmail.get(s.judge)!, project: s.project, status: "submitted" as const, review: { status: "submitted" as const, comment: s.comment, scores: s.criteria } })),
  };
}
