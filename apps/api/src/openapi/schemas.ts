// Response shapes for the endpoints integrations use most. They document the API and are also
// checked against real responses in tests/integration/openapi.test.ts, so they can't drift.
// Objects are "loose": a response may carry more fields than listed, never fewer.
import { z } from "zod";

const id = z.uuid();
const date = z.iso.datetime();
const window = z.enum(["not_open", "open", "closed"]);
const nullableUrl = z.string().nullable();

export const ErrorResponse = z
  .object({
    error: z.looseObject({
      code: z.string().describe('Stable, machine-readable, e.g. "forbidden" or "submissions_closed".'),
      message: z.string().describe("Human-readable; safe to show to people."),
      details: z.unknown().optional().describe("Validation issues for invalid_request errors."),
      requestId: z.string().optional().describe("Quote this when reporting a 500."),
    }),
  });

export const Health = z.object({ ok: z.literal(true) });

export const Me = z.object({
  user: z.object({ id, email: z.email(), name: z.string(), isAdmin: z.boolean() }).nullable(),
  roles: z.array(z.object({ role: z.enum(["participant", "judge", "organizer"]), event: z.object({ slug: z.string(), name: z.string() }) })),
});

const TokenView = z
  .object({
    id,
    name: z.string(),
    prefix: z.string().describe("The first characters of the token, to tell tokens apart."),
    scopes: z.array(z.enum(["read", "write"])),
    state: z.enum(["active", "expired", "revoked"]),
    createdAt: date,
    expiresAt: date.nullable(),
    lastUsedAt: date.nullable(),
    lastUsedIp: z.string().nullable(),
    revokedAt: date.nullable(),
  });

export const TokenList = z.object({ tokens: z.array(TokenView), limits: z.looseObject({ maxActive: z.number().int() }) });
export const TokenCreated = z.object({ token: TokenView, secret: z.string().startsWith("dfp_").describe("The token itself. Shown once; store it now.") });

const EventCard = z.looseObject({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  submissionsOpenAt: date,
  submissionsCloseAt: date,
  judgingOpensAt: date.nullable(),
  judgingClosesAt: date.nullable(),
  submissionWindow: window,
  registrationWindow: window,
  projectCount: z.number().int(),
  participantCount: z.number().int(),
  tracks: z.array(z.string()),
  prizeTotal: z.string().nullable(),
});
export const EventList = z.object({ events: z.array(EventCard) });

export const EventDetail = z.looseObject({
  event: z.looseObject({
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    submissionsOpenAt: date,
    submissionsCloseAt: date,
    judgingOpensAt: date.nullable(),
    judgingClosesAt: date.nullable(),
    maxTeamSize: z.number().int(),
    submissionWindow: window,
    registrationWindow: window,
    resultsPublished: z.boolean(),
    votingWindow: z.enum(["off", "not_open", "open", "closed"]),
    votingPublished: z.boolean(),
  }),
  stats: z.object({ participants: z.number().int(), teams: z.number().int(), projects: z.number().int(), prizeTotal: z.string().nullable() }),
  tracks: z.array(z.looseObject({ id, name: z.string(), projectCount: z.number().int() })),
  prizes: z.array(z.looseObject({ id, name: z.string(), value: z.string().nullable(), trackId: id.nullable() })),
  criteria: z.array(z.looseObject({ id, key: z.string(), label: z.string(), weight: z.number(), minScore: z.number().int(), maxScore: z.number().int() })),
  myRoles: z.array(z.enum(["participant", "judge", "organizer"])).describe("The caller's roles in this event; empty for visitors."),
});

const GalleryItem = z.looseObject({
  id,
  externalId: z.string().nullable(),
  title: z.string(),
  tagline: z.string().nullable(),
  repoUrl: nullableUrl,
  demoUrl: nullableUrl,
  thumbnailUrl: nullableUrl,
  techTags: z.array(z.string()),
  submittedAt: date.nullable(),
  track: z.object({ id, externalId: z.string().nullable(), name: z.string() }).nullable(),
  team: z.object({ id, name: z.string() }),
});
export const Gallery = z.object({ event: z.object({ slug: z.string(), name: z.string() }), total: z.number().int(), projects: z.array(GalleryItem) });

export const ProjectDetail = z.looseObject({
  project: z.looseObject({
    id,
    title: z.string(),
    description: z.string(),
    status: z.enum(["draft", "submitted", "withdrawn"]),
    submittedAt: date.nullable(),
    updatedAt: date,
    team: z.object({ id, name: z.string(), members: z.array(z.object({ name: z.string(), role: z.string() })) }),
  }),
  answers: z.array(z.looseObject({ questionId: id, label: z.string(), value: z.string() })),
  canEdit: z.boolean(),
  submissionWindow: window,
});

export const PublishedResults = z.looseObject({
  event: z.object({ slug: z.string(), name: z.string() }),
  publishedRun: z.object({ id, method: z.string(), computedAt: date }),
  results: z.array(
    z.object({
      rank: z.number().int(),
      score: z.number().nullable().describe("Normalized score on the rubric's scale."),
      reviews: z.number().int(),
      provisional: z.boolean().describe("Fewer reviews than the event's target."),
      project: z.looseObject({ id, title: z.string(), team: z.string() }),
    }),
  ),
});

export const VotingResults = z.looseObject({
  event: z.object({ slug: z.string(), name: z.string() }),
  publishedAt: date,
  votesPerVoter: z.number().int(),
  method: z.string(),
  stats: z.looseObject({ voters: z.number().int(), votes: z.number().int(), quarantinedBallots: z.number().int() }),
  ranking: z.array(z.looseObject({ rank: z.number().int(), votes: z.number().int(), project: z.looseObject({ id, title: z.string() }) })),
  ballotFile: z.object({ url: z.string(), sha256: z.string().length(64), matches: z.boolean(), ballots: z.number().int() }),
});

export const Upload = z.object({ url: z.string(), mimeType: z.string(), sizeBytes: z.number().int() });
