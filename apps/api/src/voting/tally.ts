// Counting the community vote, publishing it so anyone can recount, and checking that the random
// ballot order did its job. Pure functions, no I/O.
import { canonicalJson, sha256 } from "../lib/crypto";

export const VOTE_METHOD = "approval-v1: each voter picks up to N projects; one pick is one vote; quarantined ballots are not counted";

export type TallyBallot = {
  receipt: string;
  counted: boolean; // false = quarantined by an organizer
  choices: Array<{ projectId: string; position: number }>;
};

export type TallyRow = { projectId: string; votes: number; share: number; rank: number };

/**
 * One pick = one vote. Only counted ballots, and only projects still on the ballot (a project
 * disqualified after voting simply drops out). Ties share a rank ("1, 2, 2, 4"): a coin flip
 * would pretend to a precision the vote doesn't have.
 */
export function tally(ballots: TallyBallot[], eligible: string[]): { rows: TallyRow[]; voters: number; votes: number } {
  const on = new Set(eligible);
  const votes = new Map(eligible.map((id) => [id, 0]));
  let voters = 0;
  let total = 0;
  for (const b of ballots) {
    if (!b.counted) continue;
    const picks = b.choices.filter((c) => on.has(c.projectId));
    if (picks.length === 0) continue;
    voters++;
    for (const c of picks) {
      votes.set(c.projectId, votes.get(c.projectId)! + 1);
      total++;
    }
  }
  const sorted = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rows: TallyRow[] = [];
  sorted.forEach(([projectId, v], i) => {
    const rank = i > 0 && sorted[i - 1]![1] === v ? rows[i - 1]!.rank : i + 1;
    rows.push({ projectId, votes: v, share: total ? v / total : 0, rank });
  });
  return { rows, voters, votes: total };
}

// Chi-square critical values at α = 0.01 for 1–9 degrees of freedom.
const CHI2_01 = [6.635, 9.21, 11.345, 13.277, 15.086, 16.812, 18.475, 20.09, 21.666];

/**
 * Did a project's place in the list affect its chances? Each voter saw the projects in their own
 * random order, so if position didn't matter, picks spread over positions in proportion to how
 * many positions each bucket holds. A chi-square test compares what happened with that.
 */
export function positionCheck(ballots: TallyBallot[], projectCount: number, buckets = 5) {
  const k = Math.max(1, Math.min(buckets, projectCount));
  const bucketOf = (pos: number) => Math.min(k - 1, Math.floor((pos * k) / projectCount));
  const size = Array.from({ length: k }, (_, b) => Array.from({ length: projectCount }, (_, p) => p).filter((p) => bucketOf(p) === b).length);
  const observed = Array<number>(k).fill(0);
  let n = 0;
  for (const b of ballots) {
    if (!b.counted) continue;
    for (const c of b.choices) {
      if (c.position < 0 || c.position >= projectCount) continue;
      observed[bucketOf(c.position)]!++;
      n++;
    }
  }
  const expected = size.map((s) => (n * s) / projectCount);
  const chi2 = expected.reduce((sum, e, i) => (e > 0 ? sum + (observed[i]! - e) ** 2 / e : sum), 0);
  const df = k - 1;
  const critical = CHI2_01[df - 1] ?? null;
  return {
    picks: n,
    buckets: observed.map((o, i) => {
      const first = size.slice(0, i).reduce((a, b) => a + b, 0) + 1;
      return { label: size[i] === 1 ? `#${first}` : `#${first}–${first + size[i]! - 1}`, observed: o, expected: Math.round(expected[i]! * 10) / 10 };
    }),
    chi2: Math.round(chi2 * 100) / 100,
    df,
    critical,
    // Too few picks to say anything (a common rule of thumb: every expected count ≥ 5).
    enoughData: expected.every((e) => e >= 5),
    positionEffect: critical !== null && expected.every((e) => e >= 5) && chi2 > critical,
  };
}

/** What a voter can look up without revealing who they are: the hash of their receipt. */
export const receiptHash = (receipt: string) => sha256(`dogfood-receipt:${receipt.trim().toUpperCase()}`);

/**
 * The public ballot file: every ballot, anonymous, sorted by receipt hash (so neither time nor
 * identity can be read off the order). Enough to recount the result and to repeat the position
 * check. Its SHA-256 is fixed when results are published.
 */
export function ballotFile(ballots: TallyBallot[], projects: Array<{ id: string; title: string }>, meta: { event: string; method: string }) {
  const body = {
    event: meta.event,
    method: meta.method,
    projects: [...projects].sort((a, b) => a.id.localeCompare(b.id)),
    ballots: ballots
      .map((b) => ({
        receiptHash: receiptHash(b.receipt),
        status: b.counted ? "counted" : "quarantined",
        picks: [...b.choices].sort((x, y) => x.projectId.localeCompare(y.projectId)).map((c) => ({ projectId: c.projectId, position: c.position })),
      }))
      .filter((b) => b.picks.length > 0)
      .sort((a, b) => a.receiptHash.localeCompare(b.receiptHash)),
  };
  return { body, sha256: sha256(canonicalJson(body)) };
}
