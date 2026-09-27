import { Router } from "express";
import { z } from "zod";
import type { Prisma, Project, SubmissionQuestion } from "@prisma/client";
import { prisma } from "../db";
import {
  accessFor,
  decideEditProject,
  decideViewProject,
  decideWriteSubmission,
  enforce,
  submissionWindow,
} from "../policy";
import { appendAudit, audit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { optionalImage, optionalUrl } from "../lib/validation";

export const projectsRouter = Router({ mergeParams: true });

const slugOf = (req: import("express").Request) => (req.params as { slug?: string }).slug;

const GalleryQuery = z.object({
  q: z.string().trim().max(100).optional(),
  track: z.string().trim().max(100).optional(), // track id or its imported external id
});

/** Public gallery: submitted, non-duplicate projects. No auth required. */
projectsRouter.get("/", async (req, res) => {
  const event = await eventBySlug(slugOf(req));
  const { q, track } = GalleryQuery.parse(req.query);

  const where: Prisma.ProjectWhereInput = { eventId: event.id, status: "submitted", duplicateOfId: null };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { tagline: { contains: q, mode: "insensitive" } },
      { team: { name: { contains: q, mode: "insensitive" } } },
      { techTags: { has: q.toLowerCase() } },
    ];
  }
  if (track) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(track);
    where.track = isUuid ? { id: track } : { externalId: track };
  }

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: {
      id: true, externalId: true, title: true, tagline: true, repoUrl: true, demoUrl: true,
      videoUrl: true, thumbnailUrl: true, techTags: true, submittedAt: true,
      track: { select: { id: true, externalId: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  });
  res.json({ event: { slug: event.slug, name: event.name }, total: projects.length, projects });
});

// ── editable fields ─────────────────────────────────────────────────────────

const ProjectFields = z.object({
  title: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200),
  description: z.string().max(20_000),
  trackId: z.uuid().nullable(),
  repoUrl: optionalUrl,
  demoUrl: optionalUrl,
  videoUrl: optionalUrl,
  thumbnailUrl: optionalImage,
  techTags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).transform((t) => [...new Set(t)]),
});

const CreateProjectBody = ProjectFields.partial().required({ title: true });
const UpdateProjectBody = ProjectFields.partial().extend({
  answers: z.record(z.uuid(), z.string().max(5000)).optional(), // questionId -> value; "" clears
});

const FIELD_LABELS: Record<string, string> = { title: "a title", tagline: "a tagline", description: "a description", repoUrl: "a repository URL", trackId: "a track" };
const listMissing = (missing: string[]) => missing.map((m) => FIELD_LABELS[m] ?? m).join(", ");

/** What a project must have before it can be submitted (drafts can be incomplete). */
function missingForSubmission(p: Project, eventHasTracks: boolean, questions: SubmissionQuestion[], answers: Map<string, string>): string[] {
  const missing: string[] = [];
  if (!p.title.trim()) missing.push("title");
  if (!p.tagline.trim()) missing.push("tagline");
  if (!p.description.trim()) missing.push("description");
  if (!p.repoUrl) missing.push("repoUrl");
  if (eventHasTracks && !p.trackId) missing.push("trackId");
  for (const q of questions) {
    if (!q.required) continue;
    const v = answers.get(q.id) ?? "";
    if (q.type === "checkbox" ? v !== "true" : !v.trim()) missing.push(`"${q.label}"`);
  }
  return missing;
}

/** Everything the submission check needs, in one place. */
async function submissionContext(eventId: string, projectId: string) {
  const [trackCount, questions, answers] = await Promise.all([
    prisma.track.count({ where: { eventId } }),
    prisma.submissionQuestion.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.projectAnswer.findMany({ where: { projectId } }),
  ]);
  return { hasTracks: trackCount > 0, questions, answers: new Map(answers.map((a) => [a.questionId, a.value])) };
}

/** Check an answer against its question's type. Returns the normalized value ("" = delete). */
function normalizeAnswer(q: SubmissionQuestion, raw: string): string {
  const v = raw.trim();
  if (v === "") return "";
  const bad = (why: string) => new HttpError(400, "invalid_answer", `"${q.label}" ${why}`);
  switch (q.type) {
    case "short_text":
      if (v.length > 300) throw bad("must be 300 characters or fewer.");
      return v;
    case "long_text":
      return raw;
    case "url":
      if (!optionalUrl.safeParse(v).success) throw bad("must be an http(s) link.");
      return v;
    case "single_select":
      if (!q.options.includes(v)) throw bad(`must be one of: ${q.options.join(", ")}.`);
      return v;
    case "checkbox":
      if (v !== "true" && v !== "false") throw bad("must be true or false.");
      return v;
  }
}

async function assertTrack(trackId: string | null | undefined, eventId: string) {
  if (!trackId) return;
  if (!(await prisma.track.findFirst({ where: { id: trackId, eventId }, select: { id: true } })))
    throw new HttpError(400, "invalid_track", "That track does not belong to this event.");
}

async function refusedLate(req: import("express").Request, eventId: string, outcome: string, projectId?: string) {
  if (outcome === "closed" || outcome === "not_open") {
    // Late attempts are evidence of deadline gaming; keep a record the organizer can read.
    await audit({ ...fromRequest(req), eventId, action: "submission.refused_" + outcome, entityType: "Project", entityId: projectId ?? null, after: { title: req.body?.title ?? null } });
  }
}

/** Create a draft for the caller's team. The deadline is checked before anything else about the request. */
projectsRouter.post("/", async (req, res) => {
  const event = await eventBySlug(slugOf(req));
  const access = await accessFor(req.actor, event.id);
  const outcome = decideWriteSubmission(access, submissionWindow(event));
  await refusedLate(req, event.id, outcome);
  if (outcome === "forbidden") throw new HttpError(403, "not_on_team", "Join or create a team before submitting.");
  enforce(outcome);
  const actor = access.actor!;

  const membership = await prisma.teamMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: actor.id } } });
  if (!membership) throw new HttpError(403, "not_on_team", "Join or create a team before submitting.");

  const body = CreateProjectBody.parse(req.body);
  await assertTrack(body.trackId, event.id);
  const live = await prisma.project.findFirst({
    where: { eventId: event.id, teamId: membership.teamId, duplicateOfId: null, status: { not: "withdrawn" } },
    select: { id: true },
  });
  if (live) throw new HttpError(409, "team_has_project", "Your team already has a project. Edit it instead.", { projectId: live.id });

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({ data: { ...body, eventId: event.id, teamId: membership.teamId, status: "draft" } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "project.create", entityType: "Project", entityId: created.id, after: created });
    return created;
  });
  res.status(201).json({ project });
});

/** Load a project of this event plus whether the caller is on its team. */
async function projectContext(req: import("express").Request) {
  const event = await eventBySlug(slugOf(req));
  const projectId = (req.params as { projectId: string }).projectId;
  const project = /^[0-9a-f-]{36}$/i.test(projectId)
    ? await prisma.project.findFirst({ where: { id: projectId, eventId: event.id } })
    : null;
  if (!project) throw notFound("Project");
  const access = await accessFor(req.actor, event.id);
  const isTeamMember = !!access.actor && !!(await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: project.teamId, userId: access.actor.id } },
  }));
  return { event, project, access, isTeamMember };
}

projectsRouter.get("/:projectId", async (req, res) => {
  const { event, project, access, isTeamMember } = await projectContext(req);
  // Not allowed looks the same as not there, so drafts can't be discovered by guessing ids.
  if (decideViewProject(access, project, isTeamMember) !== "allow") throw notFound("Project");

  const full = await prisma.project.findUniqueOrThrow({
    where: { id: project.id },
    include: {
      track: { select: { id: true, name: true } },
      team: { select: { id: true, name: true, members: { orderBy: { joinedAt: "asc" }, select: { role: true, user: { select: { name: true } } } } } },
    },
  });
  const window = submissionWindow(event);
  const privileged = isTeamMember || !!access.actor?.isAdmin || access.roles.has("organizer");
  const questions = await prisma.submissionQuestion.findMany({
    where: { eventId: event.id, ...(privileged ? {} : { isPublic: true }) },
    orderBy: { position: "asc" },
    include: { answers: { where: { projectId: project.id } } },
  });
  res.json({
    answers: questions
      .map((q) => ({ questionId: q.id, label: q.label, type: q.type, isPublic: q.isPublic, value: q.answers[0]?.value ?? "" }))
      .filter((a) => privileged || a.value !== ""),
    project: {
      id: full.id, externalId: full.externalId, title: full.title, tagline: full.tagline, description: full.description,
      repoUrl: full.repoUrl, demoUrl: full.demoUrl, videoUrl: full.videoUrl, thumbnailUrl: full.thumbnailUrl,
      techTags: full.techTags, status: full.status, submittedAt: full.submittedAt, updatedAt: full.updatedAt,
      track: full.track,
      team: { id: full.team.id, name: full.team.name, members: full.team.members.map((m) => ({ name: m.user.name, role: m.role })) },
      duplicateOf: isTeamMember || access.actor?.isAdmin || access.roles.has("organizer") ? full.duplicateOfId : undefined,
    },
    canEdit: isTeamMember && window === "open",
    submissionWindow: window,
  });
});

/** Edit until the deadline: drafts and submitted projects alike. Only changed fields are audited. */
projectsRouter.patch("/:projectId", async (req, res) => {
  const { event, project, access, isTeamMember } = await projectContext(req);
  const outcome = decideEditProject(access, submissionWindow(event), isTeamMember);
  await refusedLate(req, event.id, outcome, project.id);
  enforce(outcome);
  if (project.status === "withdrawn" || project.status === "disqualified")
    throw new HttpError(409, "project_locked", `This project is ${project.status}.`);

  const { answers: answerInput, ...body } = UpdateProjectBody.parse(req.body);
  await assertTrack(body.trackId, event.id);
  const ctx = await submissionContext(event.id, project.id);

  const answerChanges = new Map<string, string>();
  for (const [questionId, raw] of Object.entries(answerInput ?? {})) {
    const q = ctx.questions.find((x) => x.id === questionId);
    if (!q) throw new HttpError(400, "invalid_question", "That question does not belong to this event.");
    const v = normalizeAnswer(q, raw);
    if ((ctx.answers.get(questionId) ?? "") !== v) answerChanges.set(questionId, v);
  }
  if (project.status === "submitted") {
    const nextAnswers = new Map(ctx.answers);
    for (const [k, v] of answerChanges) nextAnswers.set(k, v);
    const missing = missingForSubmission({ ...project, ...body } as Project, ctx.hasTracks, ctx.questions, nextAnswers);
    if (missing.length) throw new HttpError(422, "incomplete_submission", `A submitted project still needs ${listMissing(missing)}.`, { missing });
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const [questionId, value] of answerChanges) {
      if (value === "") await tx.projectAnswer.deleteMany({ where: { projectId: project.id, questionId } });
      else
        await tx.projectAnswer.upsert({
          where: { projectId_questionId: { projectId: project.id, questionId } },
          update: { value },
          create: { projectId: project.id, questionId, value },
        });
    }
    if (answerChanges.size) {
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id, action: "project.answers", entityType: "Project", entityId: project.id,
        before: Object.fromEntries([...answerChanges.keys()].map((k) => [k, ctx.answers.get(k) ?? ""])),
        after: Object.fromEntries(answerChanges),
      });
    }
    const u = await tx.project.update({ where: { id: project.id }, data: body });
    const changed = (Object.keys(body) as Array<keyof typeof body>).filter((k) => JSON.stringify(project[k]) !== JSON.stringify(u[k]));
    if (changed.length) {
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id, action: "project.update", entityType: "Project", entityId: project.id,
        before: Object.fromEntries(changed.map((k) => [k, project[k]])),
        after: Object.fromEntries(changed.map((k) => [k, u[k]])),
      });
    }
    return u;
  });
  res.json({ project: updated });
});

async function transition(
  req: import("express").Request,
  res: import("express").Response,
  to: "submitted" | "draft" | "withdrawn",
) {
  const { event, project, access, isTeamMember } = await projectContext(req);
  const outcome = decideEditProject(access, submissionWindow(event), isTeamMember);
  await refusedLate(req, event.id, outcome, project.id);
  enforce(outcome);

  const allowedFrom: Record<typeof to, Project["status"][]> = {
    submitted: ["draft"],
    draft: ["submitted"],
    withdrawn: ["draft", "submitted"],
  };
  if (!allowedFrom[to].includes(project.status))
    throw new HttpError(409, "invalid_transition", `A ${project.status} project cannot become ${to}.`);
  if (to === "submitted") {
    const ctx = await submissionContext(event.id, project.id);
    const missing = missingForSubmission(project, ctx.hasTracks, ctx.questions, ctx.answers);
    if (missing.length) throw new HttpError(422, "incomplete_submission", `Before submitting, add ${listMissing(missing)}.`, { missing });
  }

  const updated = await prisma.$transaction(async (tx) => {
    // submittedAt is the first submission time; re-submitting after unsubmitting keeps the original.
    const u = await tx.project.update({
      where: { id: project.id },
      data: { status: to, submittedAt: to === "submitted" ? (project.submittedAt ?? new Date()) : project.submittedAt },
    });
    await appendAudit(tx, {
      ...fromRequest(req), eventId: event.id, action: `project.${to === "draft" ? "unsubmit" : to === "submitted" ? "submit" : "withdraw"}`,
      entityType: "Project", entityId: project.id, before: { status: project.status }, after: { status: u.status },
    });
    return u;
  });
  res.json({ project: updated });
}

projectsRouter.post("/:projectId/submit", (req, res) => transition(req, res, "submitted"));
projectsRouter.post("/:projectId/unsubmit", (req, res) => transition(req, res, "draft"));
projectsRouter.post("/:projectId/withdraw", (req, res) => transition(req, res, "withdrawn"));
