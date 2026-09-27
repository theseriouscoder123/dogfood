import { describe, expect, it } from "vitest";
import { addressStem, detectSignals, groupIncidents, subnetOf, type AbuseBallot } from "../../src/voting/abuse";
import { isDisposableEmail } from "../../src/voting/disposable";
import { rng } from "../../src/judging/assign";

const MIN = 60_000;
const t0 = new Date("2026-09-28T09:00:00Z").getTime();
const at = (m: number) => new Date(t0 + m * MIN);
const projects = Array.from({ length: 12 }, (_, i) => `p${i}`);

/** 60 ordinary voters over 10 hours: own networks, old accounts, varied picks they looked at. */
function organic(seed = 1): AbuseBallot[] {
  const r = rng(seed);
  return Array.from({ length: 60 }, (_, i) => {
    const picks = [...projects].sort(() => r() - 0.5).slice(0, 1 + (i % 3));
    return {
      ballotId: `b${String(i).padStart(3, "0")}`,
      email: `${["ana", "ben", "cara", "dev", "eli", "fay"][i % 6]}.${["lee", "ng", "roy", "sato", "voss"][i % 5]}.${i}x@${["gmail.com", "outlook.com", "proton.me", "uni.edu"][i % 4]}`.replace(/\.\d+x@/, "@"),
      accountCreatedAt: at(-3000 - i * 10),
      castAt: at(Math.round(r() * 600)),
      ip: `198.18.${i}.${10 + (i % 200)}`,
      choices: picks,
      viewed: [...picks, projects[i % 12]!],
      quarantined: false,
    };
  }).map((b, i) => ({ ...b, email: `${b.email!.split("@")[0]}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}@${b.email!.split("@")[1]}` }));
}

/** 12 throwaway voters: one /24, numbered addresses, made minutes ago, same single pick, never opened it. */
function ring(start = 300): AbuseBallot[] {
  return Array.from({ length: 12 }, (_, i) => ({
    ballotId: `ring${String(i).padStart(2, "0")}`,
    email: `dev.hunter${String(i + 1).padStart(2, "0")}@outlook.com`,
    accountCreatedAt: at(start + i * 0.3 - 3),
    castAt: at(start + i * 0.3),
    ip: `203.0.113.${40 + i}`,
    choices: ["p7"],
    viewed: [],
    quarantined: false,
  }));
}

describe("helpers", () => {
  it("subnetOf groups IPv4 by /24 and IPv6 by /64, and ignores junk", () => {
    expect(subnetOf("203.0.113.57")).toBe("203.0.113.0/24");
    expect(subnetOf("::ffff:203.0.113.9")).toBe("203.0.113.0/24");
    expect(subnetOf("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(subnetOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(subnetOf(null)).toBeNull();
    expect(subnetOf("not-an-ip")).toBeNull();
  });
  it("addressStem strips numbers, and only applies to numbered addresses", () => {
    expect(addressStem("dev.hunter07@outlook.com")).toBe("dev.hunter@outlook.com");
    expect(addressStem("dev.hunter12+x@outlook.com")).toBe("dev.hunter@outlook.com");
    expect(addressStem("alice@outlook.com")).toBeNull();
    expect(addressStem("a1@x.com")).toBeNull(); // too short to mean anything
  });
  it("isDisposableEmail knows common throwaway providers and their subdomains", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@eu.guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
  });
});

describe("detectSignals", () => {
  it("raises nothing on ordinary voting", () => {
    expect(detectSignals(organic())).toEqual([]);
  });

  it("catches a stuffing ring with six independent signals and groups them into one high-severity incident", () => {
    const signals = detectSignals([...organic(), ...ring()]);
    expect(new Set(signals.map((s) => s.type))).toEqual(new Set(["shared_network", "identical_ballots", "fresh_accounts", "address_pattern", "surge", "blind_votes"]));
    const incidents = groupIncidents(signals);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ severity: "high", projectIds: ["p7"] });
    expect(incidents[0]!.ballotIds).toEqual(ring().map((b) => b.ballotId).sort());
  });

  it("a class voting from one campus network is flagged, but only as low severity", () => {
    const campus = organic(2).slice(0, 7).map((b, i) => ({ ...b, ballotId: `campus${i}`, ip: `192.0.2.${20 + i}`, castAt: at(120 + i * 4) }));
    const incidents = groupIncidents(detectSignals([...organic(), ...campus]));
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ severity: "low" });
    expect(incidents[0]!.signals.map((s) => s.type)).toEqual(["shared_network"]);
  });

  it("identical picks spread across a whole day are not a burst", () => {
    const fans = Array.from({ length: 8 }, (_, i) => ({ ...organic()[i]!, ballotId: `fan${i}`, choices: ["p3"], viewed: ["p3"], castAt: at(i * 90) }));
    expect(detectSignals([...organic(), ...fans]).filter((s) => s.type === "identical_ballots")).toEqual([]);
  });

  it("keys are stable as more ballots arrive, so an organizer's decision sticks", () => {
    const before = groupIncidents(detectSignals([...organic(), ...ring()]))[0]!.key;
    const later = groupIncidents(detectSignals([...organic(), ...ring(), ...organic(3).map((b) => ({ ...b, ballotId: `late-${b.ballotId}`, castAt: at(700) }))]));
    expect(later.map((i) => i.key)).toContain(before);
  });

  it("ignores empty ballots", () => {
    const empty = ring().map((b) => ({ ...b, choices: [] }));
    expect(detectSignals(empty)).toEqual([]);
  });
});
