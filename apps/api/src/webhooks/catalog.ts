// The webhook event types an organizer can subscribe to, and what each payload carries.
//
// Payloads are deliberately thin: ids, a few public fields and API links, never scores, emails
// or comment text. A receiver that needs more fetches it with an API token, so the organizer's
// permissions still decide what it sees, and a leaked webhook log leaks very little.
//
// Ballot activity is deliberately absent: a "ballot.cast" feed would let anyone with a
// receiver watch the vote count live, which the portal keeps sealed until voting closes.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { config } from "../config";

export type AuditFacts = { action: string; entityId: string | null; after: unknown };

type Ctx = { tx: Prisma.TransactionClient; a: AuditFacts; slug: string };

type Def = {
  description: string;
  /** The audit actions that emit this type. */
  actions: string[];
  data: z.ZodType;
  build: (c: Ctx) => Promise<Record<string, unknown>>;
};

const api = (path: string) => `${config.publicBaseUrl}/api${path}`;
const id = z.uuid();
const after = (a: AuditFacts) => (a.after && typeof a.after === "object" ? (a.after as Record<string, unknown>) : {});

const ProjectRef = z.object({
  id,
  title: z.string().nullable(),
  status: z.enum(["draft", "submitted", "withdrawn"]).nullable(),
  teamId: id.nullable(),
  trackId: id.nullable(),
  url: z.url().describe("GET this with an API token for the full project."),
});

async function project(c: Ctx) {
  const p = c.a.entityId ? await c.tx.project.findUnique({ where: { id: c.a.entityId }, select: { title: true, status: true, teamId: true, trackId: true } }) : null;
  return { id: c.a.entityId, title: p?.title ?? null, status: p?.status ?? null, teamId: p?.teamId ?? null, trackId: p?.trackId ?? null, url: api(`/events/${c.slug}/projects/${c.a.entityId}`) };
}

async function team(c: Ctx) {
  const t = c.a.entityId ? await c.tx.team.findUnique({ where: { id: c.a.entityId }, select: { name: true } }) : null;
  return { team: { id: c.a.entityId, name: t?.name ?? null }, userId: (after(c.a).userId as string | undefined) ?? null };
}
const TeamData = z.object({ team: z.object({ id, name: z.string().nullable().describe("null if the team no longer exists") }), userId: id.nullable() });

const projectType = (description: string, actions: string[]): Def => ({ description, actions, data: z.object({ project: ProjectRef }), build: async (c) => ({ project: await project(c) }) });

export const WEBHOOK_EVENTS = {
  "participant.registered": {
    description: "Someone registered for the event.",
    actions: ["event.register"],
    data: z.object({ participant: z.object({ userId: id }) }),
    build: async (c) => ({ participant: { userId: c.a.entityId } }),
  },
  "team.created": { description: "A team was formed.", actions: ["team.create"], data: TeamData, build: team },
  "team.member_joined": { description: "Someone joined a team through an invite.", actions: ["team.join"], data: TeamData, build: team },
  "team.member_left": { description: "Someone left or was removed from a team.", actions: ["team.leave", "team.remove_member"], data: TeamData, build: team },
  "project.created": projectType("A team started a project (as a draft).", ["project.create"]),
  "project.updated": {
    description: "A project's details or answers changed.",
    actions: ["project.update", "project.answers"],
    data: z.object({ project: ProjectRef, changed: z.array(z.string()).describe("Names of the fields that changed (answers by question id).") }),
    build: async (c) => ({ project: await project(c), changed: Object.keys(after(c.a)) }),
  },
  "project.submitted": projectType("A project was submitted for judging.", ["project.submit"]),
  "project.unsubmitted": projectType("A submitted project went back to draft before the deadline.", ["project.unsubmit"]),
  "project.withdrawn": projectType("A project was withdrawn.", ["project.withdraw"]),
  "comment.created": {
    description: "A comment or reply was posted on a project.",
    actions: ["comment.created"],
    data: z.object({ comment: z.object({ id, projectId: id, parentId: id.nullable() }) }),
    build: async (c) => ({ comment: { id: c.a.entityId, projectId: after(c.a).projectId, parentId: after(c.a).parentId ?? null } }),
  },
  "comment.reported": {
    description: "Someone reported a comment. Useful for a moderation channel.",
    actions: ["comment.reported"],
    data: z.object({ comment: z.object({ id, projectId: id.nullable() }), reason: z.string() }),
    build: async (c) => {
      const cm = c.a.entityId ? await c.tx.comment.findUnique({ where: { id: c.a.entityId }, select: { projectId: true } }) : null;
      return { comment: { id: c.a.entityId, projectId: cm?.projectId ?? null }, reason: after(c.a).reason };
    },
  },
  "judge.invited": {
    description: "An organizer invited a judge.",
    actions: ["judge.invite"],
    data: z.object({ judge: z.object({ userId: id }) }),
    build: async (c) => ({ judge: { userId: c.a.entityId } }),
  },
  "assignments.committed": {
    description: "An assignment plan was committed: judges have new work.",
    actions: ["assignments.batch_committed"],
    data: z.object({ batch: z.object({ id, assignments: z.number().int() }) }),
    build: async (c) => ({ batch: { id: c.a.entityId, assignments: after(c.a).created } }),
  },
  "review.submitted": {
    description: "A judge submitted a review, or revised a submitted one. Scores are not included.",
    actions: ["review.submit", "review.revised"],
    data: z.object({ review: z.object({ id, projectId: id.nullable(), judgeId: id.nullable(), revised: z.boolean() }) }),
    build: async (c) => {
      const r = c.a.entityId ? await c.tx.review.findUnique({ where: { id: c.a.entityId }, select: { projectId: true, judgeId: true } }) : null;
      return { review: { id: c.a.entityId, projectId: r?.projectId ?? null, judgeId: r?.judgeId ?? null, revised: c.a.action === "review.revised" } };
    },
  },
  "results.published": {
    description: "Judging results were published.",
    actions: ["results.published"],
    data: z.object({ run: z.object({ id }), url: z.url() }),
    build: async (c) => ({ run: { id: c.a.entityId }, url: api(`/events/${c.slug}/results`) }),
  },
  "results.unpublished": { description: "Published judging results were taken down.", actions: ["results.unpublished"], data: z.object({}), build: async () => ({}) },
  "peoples_choice.published": {
    description: "People's Choice results were published, with the fingerprint of the ballot file.",
    actions: ["voting.results_published"],
    data: z.object({ ballots: z.number().int(), ballotsSha256: z.string().length(64), url: z.url() }),
    build: async (c) => ({ ballots: after(c.a).ballots, ballotsSha256: after(c.a).ballotsHash, url: api(`/events/${c.slug}/voting/results`) }),
  },
  "peoples_choice.unpublished": { description: "People's Choice results were taken down.", actions: ["voting.results_unpublished"], data: z.object({}), build: async () => ({}) },
  "records.issued": {
    description: "Signed participation records and certificates were issued (or re-issued with updated facts).",
    actions: ["records.issued"],
    data: z.object({ issued: z.number().int(), superseded: z.number().int(), unchanged: z.number().int() }),
    build: async (c) => ({ issued: after(c.a).issued, superseded: after(c.a).superseded, unchanged: after(c.a).unchanged }),
  },
  "event.updated": {
    description: "The event's details or dates changed.",
    actions: ["event.update"],
    data: z.object({ changed: z.array(z.string()) }),
    build: async (c) => ({ changed: Object.keys(after(c.a)) }),
  },
} satisfies Record<string, Def>;

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

/** Sent by "Send test"; not subscribable, always delivered. */
export const PING_TYPE = "webhook.ping";
export const PingData = z.object({ webhookId: id, message: z.string() });

const byAction = new Map<string, WebhookEventType>();
for (const [type, def] of Object.entries(WEBHOOK_EVENTS) as Array<[WebhookEventType, Def]>) for (const a of def.actions) byAction.set(a, type);

export const typeForAction = (action: string): WebhookEventType | null => byAction.get(action) ?? null;

export const subscribes = (eventTypes: readonly string[], type: string) => type === PING_TYPE || eventTypes.length === 0 || eventTypes.includes(type);

/** The envelope every delivery shares. */
export const Envelope = z.object({
  id: z.string().describe('Unique per event occurrence, e.g. "evt_1042". The same on retries and redeliveries: de-duplicate on it.'),
  type: z.string(),
  timestamp: z.iso.datetime().describe("When the change happened."),
  event: z.object({ slug: z.string(), name: z.string() }),
  data: z.record(z.string(), z.unknown()),
});

export const buildData = (type: WebhookEventType, c: Ctx) => (WEBHOOK_EVENTS[type] as Def).build(c);
