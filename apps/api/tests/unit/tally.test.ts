import { describe, expect, it } from "vitest";
import { ballotFile, positionCheck, receiptHash, tally, type TallyBallot } from "../../src/voting/tally";
import { ballotOrder } from "../../src/voting/core";
import { rng } from "../../src/judging/assign";

const b = (receipt: string, picks: string[], counted = true): TallyBallot => ({ receipt, counted, choices: picks.map((projectId, position) => ({ projectId, position })) });

describe("tally", () => {
  it("counts one vote per pick from counted ballots only, and shares ranks on ties", () => {
    const res = tally(
      [b("R1", ["a", "b"]), b("R2", ["a", "c"]), b("R3", ["b"]), b("R4", ["c", "a"]), b("Q1", ["d", "d2"], false), b("E", [])],
      ["a", "b", "c", "d"],
    );
    expect(res).toMatchObject({ voters: 4, votes: 7 });
    expect(res.rows.map((r) => [r.projectId, r.votes, r.rank])).toEqual([["a", 3, 1], ["b", 2, 2], ["c", 2, 2], ["d", 0, 4]]);
    expect(res.rows[0]!.share).toBeCloseTo(3 / 7);
  });
  it("ignores picks for projects no longer on the ballot", () => {
    const res = tally([b("R1", ["gone", "a"]), b("R2", ["gone"])], ["a"]);
    expect(res).toMatchObject({ voters: 1, votes: 1 });
  });
});

describe("positionCheck", () => {
  const projects = Array.from({ length: 15 }, (_, i) => `p${String(i).padStart(2, "0")}`);
  /** Voters who pick by taste, seeing the list in their own shuffled order. */
  function voters(n: number, biased: boolean): TallyBallot[] {
    const r = rng(7);
    const taste = new Map(projects.map((p, i) => [p, i / 15]));
    return Array.from({ length: n }, (_, v) => {
      const order = ballotOrder(projects, `evt:user:${v}`);
      const score = (p: string) => taste.get(p)! + r() * 0.6 + (biased ? (order.indexOf(p) < 3 ? 2 : 0) : 0);
      const picks = [...projects].sort((a, c) => score(c) - score(a)).slice(0, 3);
      return { receipt: `R${v}`, counted: true, choices: picks.map((p) => ({ projectId: p, position: order.indexOf(p) })) };
    });
  }

  it("finds no position effect when the order is random and voters pick on merit", () => {
    const res = positionCheck(voters(400, false), 15);
    expect(res.enoughData).toBe(true);
    expect(res.positionEffect).toBe(false);
    expect(res.buckets.map((x) => x.label)).toEqual(["#1–3", "#4–6", "#7–9", "#10–12", "#13–15"]);
  });
  it("detects it when voters favour whatever is listed first", () => {
    const res = positionCheck(voters(400, true), 15);
    expect(res.positionEffect).toBe(true);
    expect(res.buckets[0]!.observed).toBeGreaterThan(res.buckets[0]!.expected * 2);
  });
  it("says so when there's too little data to judge", () => {
    expect(positionCheck(voters(4, false), 15)).toMatchObject({ enoughData: false, positionEffect: false });
  });
});

describe("ballotFile", () => {
  const projects = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
  it("publishes anonymous ballots, sorted by receipt hash, with a stable fingerprint", () => {
    const ballots = [b("DF-AAAAA-BBBBB", ["b", "a"]), b("DF-CCCCC-DDDDD", ["a"], false), b("DF-EMPTY-EMPTY", [])];
    const f = ballotFile(ballots, projects, { event: "demo", method: "approval" });
    expect(f.body.ballots).toHaveLength(2); // empty ballots have nothing to recount
    expect(JSON.stringify(f.body)).not.toContain("DF-AAAAA");
    expect(f.body.ballots.map((x) => x.receiptHash)).toEqual([...f.body.ballots.map((x) => x.receiptHash)].sort());
    expect(f.body.ballots.find((x) => x.receiptHash === receiptHash("df-aaaaa-bbbbb"))!.picks.map((p) => p.projectId)).toEqual(["a", "b"]);
    expect(ballotFile([...ballots].reverse(), [...projects].reverse(), { event: "demo", method: "approval" }).sha256).toBe(f.sha256);
  });
  it("lets anyone recount the published result from the file alone", () => {
    const ballots = Array.from({ length: 30 }, (_, i) => b(`R${i}`, i % 3 ? ["a", "b"] : ["b"], i % 7 !== 0));
    const file = ballotFile(ballots, projects, { event: "demo", method: "approval" }).body;
    const recount = new Map<string, number>();
    for (const x of file.ballots) if (x.status === "counted") for (const p of x.picks) recount.set(p.projectId, (recount.get(p.projectId) ?? 0) + 1);
    const official = tally(ballots, ["a", "b"]).rows;
    for (const r of official) expect(recount.get(r.projectId) ?? 0).toBe(r.votes);
  });
});
