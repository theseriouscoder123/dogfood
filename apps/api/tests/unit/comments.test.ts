import { describe, expect, it } from "vitest";
import { containsLink, fingerprintBody, withinEditWindow } from "../../src/comments/rules";
import { decideComment, type EventAccess } from "../../src/policy";

describe("containsLink", () => {
  it.each([
    ["see https://example.org/x", true],
    ["www.free-prizes.win", true],
    ["vote at win-prizes.xyz now", true],
    ["Great work on the parser!", false],
    ["version 1.2.3 fixed it", false],
    ["e.g. the README", false],
  ])("%s → %s", (body, expected) => expect(containsLink(body)).toBe(expected));
});

describe("fingerprintBody", () => {
  it("treats case, spacing and punctuation changes as the same comment", () => {
    expect(fingerprintBody("Great project!!!")).toBe(fingerprintBody("great   project"));
    expect(fingerprintBody("VOTE FOR US")).toBe(fingerprintBody("vote, for... us"));
    expect(fingerprintBody("Great project")).not.toBe(fingerprintBody("Great projects"));
  });
});

describe("withinEditWindow", () => {
  it("allows edits for 15 minutes", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    expect(withinEditWindow(new Date(now.getTime() - 14 * 60_000), now)).toBe(true);
    expect(withinEditWindow(new Date(now.getTime() - 16 * 60_000), now)).toBe(false);
  });
});

describe("decideComment", () => {
  const actor = { id: "u", email: "u@x.org", name: "U", isAdmin: false };
  const access = (...roles: Array<"participant" | "judge" | "organizer">): EventAccess => ({ actor, roles: new Set(roles) }) as EventAccess;
  it("respects the event's mode before anything else", () => {
    expect(decideComment(access("organizer"), "off", "closed")).toBe("comments_off");
    expect(decideComment(access(), "read_only", "closed")).toBe("comments_read_only");
  });
  it("needs a signed-in person", () => {
    expect(decideComment({ actor: null, roles: new Set() } as EventAccess, "open", "open")).toBe("unauthenticated");
    expect(decideComment(access(), "open", "open")).toBe("allow");
  });
  it("keeps judges quiet until judging has closed", () => {
    expect(decideComment(access("judge"), "open", "not_open")).toBe("judge_cannot_comment");
    expect(decideComment(access("judge"), "open", "open")).toBe("judge_cannot_comment");
    expect(decideComment(access("judge"), "open", "closed")).toBe("allow");
    expect(decideComment(access("participant"), "open", "open")).toBe("allow");
  });
});
