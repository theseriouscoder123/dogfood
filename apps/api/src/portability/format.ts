// dogfood-event/v1: one whole event as a single JSON file, for moving an event between Verdict
// installs (or into your own tools) and back. The exporter writes it; the importer reads it,
// plus the DOGFOOD fixture format through an adapter.
//
// Cross-references use stable "refs": people by email, everything else by its imported id if it
// has one, otherwise its uuid. On import, a ref becomes the new row's externalId.
//
// Deliberately NOT included, and why:
// - passwords and sessions: accounts are claimed again on the new install (register with the email)
// - ballots and voters: tied to identity checks (verified inboxes, one-time codes) that don't transfer
// - comments: third-party speech, moderation state and reports belong to the original install
// - results runs, audit log, signed records, webhooks, API tokens: bound to this install's data,
//   hash chain and keys. Results are recomputed from the reviews, which are included.
import { z } from "zod";

export const FORMAT = "dogfood-event/v1";

const Ref = z.string().min(1).max(200);
const Email = z.email().transform((e) => e.trim().toLowerCase());
const When = z.iso.datetime({ offset: true });
const Url = z.string().max(2000).nullable();

export const EventFile = z.object({
  format: z.literal(FORMAT),
  exportedAt: When.optional(),
  source: z.object({ url: z.string(), slug: z.string() }).optional(),
  event: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
    name: z.string().min(1).max(120),
    description: z.string().max(500).default(""),
    tagline: z.string().max(160).default(""),
    location: z.string().max(120).default("Online"),
    overview: z.string().max(50_000).default(""),
    rules: z.string().max(50_000).default(""),
    bannerUrl: Url.default(null),
    logoUrl: Url.default(null),
    timezone: z.string().max(64).default("UTC"),
    registrationOpensAt: When.nullable().default(null),
    submissionsOpenAt: When,
    submissionsCloseAt: When,
    judgingOpensAt: When.nullable().default(null),
    judgingClosesAt: When.nullable().default(null),
    maxTeamSize: z.number().int().min(1).max(50).default(4),
    votingOpensAt: When.nullable().default(null),
    votingClosesAt: When.nullable().default(null),
    votingMode: z.enum(["email", "invite", "accounts"]).default("email"),
    votesPerVoter: z.number().int().min(1).max(20).default(3),
    voterDomains: z.array(z.string()).default([]),
    commentsMode: z.enum(["open", "read_only", "off"]).default("open"),
  }),
  people: z.array(z.object({ email: Email, name: z.string().min(1).max(100) })),
  organizers: z.array(Email).default([]),
  tracks: z.array(z.object({ ref: Ref, name: z.string().min(1).max(80), description: z.string().max(2000).default("") })),
  prizes: z.array(z.object({ name: z.string().min(1), description: z.string().default(""), value: z.string().default(""), rank: z.number().int().nullable().default(null), track: Ref.nullable().default(null) })).default([]),
  criteria: z.array(
    z.object({ key: z.string().min(1).max(60), label: z.string().min(1).max(80), description: z.string().max(1000).default(""), weight: z.number().gt(0).max(100).default(1), minScore: z.number().int().default(1), maxScore: z.number().int().default(5), position: z.number().int().default(0) }),
  ),
  questions: z
    .array(
      z.object({
        ref: Ref,
        label: z.string().min(1),
        help: z.string().default(""),
        type: z.enum(["short_text", "long_text", "url", "single_select", "checkbox"]),
        options: z.array(z.string()).default([]),
        required: z.boolean().default(false),
        isPublic: z.boolean().default(true),
        position: z.number().int().default(0),
      }),
    )
    .default([]),
  judges: z.array(z.object({ person: Email, ref: Ref.nullable().default(null).describe("the judge's imported id, e.g. jdg_24"), tracks: z.array(Ref).default([]) })),
  teams: z.array(z.object({ ref: Ref, name: z.string().min(1).max(80), members: z.array(z.object({ person: Email, role: z.enum(["captain", "member"]) })) })),
  projects: z.array(
    z.object({
      ref: Ref,
      team: Ref,
      track: Ref.nullable(),
      title: z.string().min(1).max(120),
      tagline: z.string().default(""),
      description: z.string().default(""),
      repoUrl: Url.default(null),
      demoUrl: Url.default(null),
      videoUrl: Url.default(null),
      thumbnailUrl: Url.default(null),
      techTags: z.array(z.string()).default([]),
      status: z.enum(["draft", "submitted", "withdrawn", "disqualified"]),
      submittedAt: When.nullable().default(null),
      duplicateOf: Ref.nullable().default(null),
      answers: z.record(Ref, z.string()).default({}).describe("question ref → answer"),
    }),
  ),
  conflicts: z.array(z.object({ judge: Email, team: Ref, source: z.enum(["declared", "detected"]), note: z.string().default("") })).default([]),
  assignments: z.array(
    z.object({
      judge: Email,
      project: Ref,
      status: z.enum(["assigned", "in_progress", "submitted", "recused"]),
      recusalReason: z.string().nullable().default(null),
      review: z
        .object({ status: z.enum(["draft", "submitted"]), submittedAt: When.nullable().default(null), comment: z.string().default(""), scores: z.record(z.string(), z.number().int()) })
        .nullable()
        .default(null),
    }),
  ),
});
export type EventFile = z.infer<typeof EventFile>;
export type EventFileInput = z.input<typeof EventFile>;
