import { describe, expect, it } from "vitest";
import { ballotOrder, canonicalCode, emailDomainAllowed, makeInviteCode, makeReceipt, normalizeEmail } from "../../src/voting/core";
import { decideVote, votingWindow, type EventAccess, type VoterIdentity } from "../../src/policy";

describe("normalizeEmail: one inbox, one key", () => {
  it.each([
    ["John.Smith+hackathon@Gmail.com", "johnsmith@gmail.com"],
    ["j.o.h.n.smith@googlemail.com", "johnsmith@gmail.com"],
    ["alice+1@company.com", "alice@company.com"],
    ["  ALICE@Company.COM ", "alice@company.com"],
  ])("%s → %s", (input, key) => expect(normalizeEmail(input)).toBe(key));

  it("keeps dots where providers treat them as different inboxes", () => {
    expect(normalizeEmail("john.smith@company.com")).not.toBe(normalizeEmail("johnsmith@company.com"));
  });
});

describe("emailDomainAllowed", () => {
  it("allows anyone with an empty list, and matches domains and their subdomains", () => {
    expect(emailDomainAllowed("x@anything.org", [])).toBe(true);
    expect(emailDomainAllowed("a@company.com", ["company.com"])).toBe(true);
    expect(emailDomainAllowed("a@eng.company.com", ["@company.com"])).toBe(true);
    expect(emailDomainAllowed("a@notcompany.com", ["company.com"])).toBe(false);
    expect(emailDomainAllowed("a@company.com.evil.io", ["company.com"])).toBe(false);
  });
});

describe("ballotOrder", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, "0")}`);

  it("is a permutation, stable for one voter and different between voters", () => {
    const a = ballotOrder(ids, "evt:user:1");
    expect([...a].sort()).toEqual(ids);
    expect(ballotOrder(ids, "evt:user:1")).toEqual(a);
    expect(ballotOrder([...ids].reverse(), "evt:user:1")).toEqual(a); // input order doesn't matter
    expect(ballotOrder(ids, "evt:user:2")).not.toEqual(a);
  });

  it("puts every project first about equally often across many voters", () => {
    const first = new Map<string, number>();
    const voters = 6000;
    for (let v = 0; v < voters; v++) {
      const top = ballotOrder(ids, `evt:user:${v}`)[0]!;
      first.set(top, (first.get(top) ?? 0) + 1);
    }
    // Chi-square with 11 degrees of freedom; the 99.9th percentile is 31.3.
    const expected = voters / ids.length;
    const chi2 = ids.reduce((s, id) => s + ((first.get(id) ?? 0) - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(31.3);
  });
});

describe("receipts and ballot codes", () => {
  it("have the documented shapes, avoid look-alike characters, and don't repeat", () => {
    const receipts = new Set(Array.from({ length: 2000 }, makeReceipt));
    expect(receipts.size).toBe(2000);
    for (const r of [...receipts].slice(0, 50)) expect(r).toMatch(/^DF-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    expect(makeInviteCode()).toMatch(/^VOTE-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  });
  it("compares codes ignoring case, spaces and dashes", () => {
    expect(canonicalCode(" vote-4kx9-pm2q-t7hd ")).toBe(canonicalCode("VOTE4KX9PM2QT7HD"));
  });
});

describe("votingWindow", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
  it("is off without an opening time, then not_open → open → closed", () => {
    expect(votingWindow({ votingOpensAt: null, votingClosesAt: null }, t(5))).toBe("off");
    const e = { votingOpensAt: t(10), votingClosesAt: t(20) };
    expect(votingWindow(e, t(9))).toBe("not_open");
    expect(votingWindow(e, t(10))).toBe("open");
    expect(votingWindow(e, t(20))).toBe("closed");
  });
});

describe("decideVote", () => {
  const actor = { id: "u", email: "u@x.org", name: "U", isAdmin: false };
  const access = (...roles: Array<"participant" | "judge" | "organizer">): EventAccess => ({ actor, roles: new Set(roles) }) as EventAccess;
  const verified: VoterIdentity = { kind: "user", emailVerified: true, domainAllowed: true };
  const unverified: VoterIdentity = { kind: "user", emailVerified: false, domainAllowed: true };

  it("checks the window before anything else", () => {
    expect(decideVote(access(), "off", "email", verified)).toBe("voting_off");
    expect(decideVote(access(), "not_open", "email", verified)).toBe("voting_not_open");
    expect(decideVote(access("organizer"), "closed", "email", verified)).toBe("voting_closed");
  });
  it("keeps organizers and judges out of the community vote", () => {
    expect(decideVote(access("organizer"), "open", "email", verified)).toBe("staff_cannot_vote");
    expect(decideVote(access("judge"), "open", "accounts", verified)).toBe("staff_cannot_vote");
    expect(decideVote(access("participant"), "open", "email", verified)).toBe("allow");
  });
  it("applies each mode's identity rule", () => {
    expect(decideVote(access(), "open", "email", unverified)).toBe("email_unverified");
    expect(decideVote(access(), "open", "accounts", unverified)).toBe("allow");
    expect(decideVote(access(), "open", "email", { kind: "none" })).toBe("unauthenticated");
    expect(decideVote(access(), "open", "invite", verified)).toBe("invite_required");
    expect(decideVote(access(), "open", "invite", { kind: "invite" })).toBe("allow");
    expect(decideVote(access(), "open", "accounts", { kind: "user", emailVerified: true, domainAllowed: false })).toBe("domain_not_allowed");
  });
});
