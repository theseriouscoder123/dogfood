// The role matrix, one assertion per cell. If a rule changes, this file changes with it.
import { describe, expect, it } from "vitest";
import type { EventRoleType } from "@prisma/client";
import {
  decideCreateEvent,
  decideEditProject,
  decideParticipate,
  decideViewProject,
  registrationWindow,
  decideOrganize,
  decideReadJudgeScores,
  decideWriteSubmission,
  submissionWindow,
  type EventAccess,
} from "../../src/policy";

const actor = (id: string, isAdmin = false) => ({ id, email: `${id}@x.org`, name: id, isAdmin });
const access = (a: ReturnType<typeof actor> | null, ...roles: EventRoleType[]): EventAccess => ({ actor: a, roles: new Set(roles) });

const visitor = access(null);
const participant = access(actor("p1"), "participant");
const judgeA = access(actor("jA"), "judge");
const judgeB = access(actor("jB"), "judge");
const organizer = access(actor("o1"), "organizer");
const admin = access(actor("root", true));
const judgeWhoIsAlsoParticipant = access(actor("jP"), "judge", "participant");

describe("reading a judge's scores", () => {
  it.each([
    ["visitor", visitor, "jA", "unauthenticated"],
    ["participant", participant, "jA", "forbidden"],
    ["judge reading self", judgeA, "jA", "allow"],
    ["judge reading a peer", judgeB, "jA", "forbidden"],
    ["judge reading an unknown judge", judgeB, null, "forbidden"],
    ["organizer", organizer, "jA", "allow"],
    ["admin", admin, "jA", "allow"],
  ] as const)("%s → %s", (_label, a, target, expected) => {
    expect(decideReadJudgeScores(a, target)).toBe(expected);
  });

  it("a participant who is not a judge cannot read 'their own' judge scores", () => {
    expect(decideReadJudgeScores(participant, "p1")).toBe("forbidden");
  });
});

describe("organizer-only actions", () => {
  it.each([
    ["visitor", visitor, "unauthenticated"],
    ["participant", participant, "forbidden"],
    ["judge", judgeA, "forbidden"],
    ["organizer", organizer, "allow"],
    ["admin", admin, "allow"],
  ] as const)("%s → %s", (_label, a, expected) => {
    expect(decideOrganize(a)).toBe(expected);
  });
});

describe("submission window", () => {
  const event = { submissionsOpenAt: new Date("2026-02-26T18:00:00Z"), submissionsCloseAt: new Date("2026-03-01T18:00:00Z") };

  it("is closed exactly at the deadline, not a millisecond later", () => {
    expect(submissionWindow(event, new Date("2026-03-01T17:59:59.999Z"))).toBe("open");
    expect(submissionWindow(event, new Date("2026-03-01T18:00:00.000Z"))).toBe("closed");
  });

  it("is not open before the start", () => {
    expect(submissionWindow(event, new Date("2026-02-26T17:59:59Z"))).toBe("not_open");
  });

  it.each([
    ["visitor", visitor, "open", "unauthenticated"],
    ["participant, open", participant, "open", "allow"],
    ["participant, closed", participant, "closed", "closed"],
    ["participant, not open", participant, "not_open", "not_open"],
    ["judge, open", judgeA, "open", "forbidden"],
    ["organizer, closed (staff are not exempt)", organizer, "closed", "closed"],
    ["judge who is also a participant, open", judgeWhoIsAlsoParticipant, "open", "allow"],
  ] as const)("%s → %s", (_label, a, window, expected) => {
    expect(decideWriteSubmission(a, window)).toBe(expected);
  });
});

describe("editing and viewing projects", () => {
  it.each([
    ["visitor", visitor, "open", false, "unauthenticated"],
    ["team member, open", participant, "open", true, "allow"],
    ["team member, closed", participant, "closed", true, "closed"],
    ["participant on another team", participant, "open", false, "forbidden"],
    ["organizer who is not on the team", organizer, "open", false, "forbidden"],
  ] as const)("edit: %s → %s", (_label, a, window, member, expected) => {
    expect(decideEditProject(a, window, member)).toBe(expected);
  });

  const submitted = { status: "submitted", duplicateOfId: null };
  const draft = { status: "draft", duplicateOfId: null };
  const duplicate = { status: "submitted", duplicateOfId: "p0" };
  it.each([
    ["visitor sees a submitted project", visitor, submitted, false, "allow"],
    ["visitor cannot see a draft", visitor, draft, false, "unauthenticated"],
    ["another participant cannot see a draft", participant, draft, false, "forbidden"],
    ["team member sees own draft", participant, draft, true, "allow"],
    ["judge cannot browse drafts", judgeA, draft, false, "forbidden"],
    ["organizer sees drafts", organizer, draft, false, "allow"],
    ["visitor cannot see a flagged duplicate", visitor, duplicate, false, "unauthenticated"],
    ["admin sees a flagged duplicate", admin, duplicate, false, "allow"],
  ] as const)("view: %s", (_label, a, project, member, expected) => {
    expect(decideViewProject(a, project, member)).toBe(expected);
  });
});

describe("events and participation", () => {
  it("only admins create events", () => {
    expect(decideCreateEvent(null)).toBe("unauthenticated");
    expect(decideCreateEvent(organizer.actor)).toBe("forbidden");
    expect(decideCreateEvent(admin.actor)).toBe("allow");
  });

  const event = {
    registrationOpensAt: new Date("2026-02-01T00:00:00Z"),
    submissionsOpenAt: new Date("2026-02-26T18:00:00Z"),
    submissionsCloseAt: new Date("2026-03-01T18:00:00Z"),
  };
  it("registration runs from its opening until submissions close", () => {
    expect(registrationWindow(event, new Date("2026-01-31T23:59:59Z"))).toBe("not_open");
    expect(registrationWindow(event, new Date("2026-02-10T00:00:00Z"))).toBe("open");
    expect(registrationWindow(event, new Date("2026-03-01T18:00:00Z"))).toBe("closed");
  });
  it("without a registration date, registration opens with submissions", () => {
    expect(registrationWindow({ ...event, registrationOpensAt: null }, new Date("2026-02-10T00:00:00Z"))).toBe("not_open");
  });

  it.each([
    ["visitor", visitor, "open", "unauthenticated"],
    ["logged-in user, open", access(actor("u9")), "open", "allow"],
    ["logged-in user, closed", access(actor("u9")), "closed", "registration_closed"],
    ["logged-in user, not open", access(actor("u9")), "not_open", "registration_not_open"],
    ["judge of the same event", judgeA, "open", "judge_conflict"],
  ] as const)("participate: %s → %s", (_label, a, window, expected) => {
    expect(decideParticipate(a, window)).toBe(expected);
  });
});
