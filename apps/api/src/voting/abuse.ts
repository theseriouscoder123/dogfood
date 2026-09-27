// Detecting ballot stuffing and coordinated voting. Pure functions, no I/O.
//
// Each signal on its own has innocent explanations: a class voting from one campus network,
// friends who like the same project, a well-shared link. So signals are only evidence. They're
// merged into incidents (signals that point at the same ballots), and an incident's severity
// comes from how many *independent* signals agree. A person decides what to do about it.
//
//   shared_network    ≥5 ballots from one /24 (IPv4) or /64 (IPv6) within 30 minutes
//   identical_ballots ≥4 ballots with exactly the same picks within 15 minutes
//   fresh_accounts    ≥3 accounts created ≤10 minutes before voting, all backing one project within an hour
//   address_pattern   ≥3 addresses that differ only by a number (dev1@, dev2@, dev3@)
//   surge             a project's votes in one 15-minute slot at ≥4× its usual rate (and ≥5 votes)
//   blind_votes       ≥5 votes for a project from voters who never opened it, at ≥40% of its votes
//                     and ≥2× the blind rate on the event's other projects

export type AbuseBallot = {
  ballotId: string;
  email: string | null; // null for ballot-code voters
  accountCreatedAt: Date | null;
  castAt: Date;
  ip: string | null;
  choices: string[];
  viewed: string[]; // projects this voter opened while voting was open
  quarantined: boolean;
};

export type SignalType = "shared_network" | "identical_ballots" | "fresh_accounts" | "address_pattern" | "surge" | "blind_votes";

export type Signal = {
  key: string;
  type: SignalType;
  ballotIds: string[];
  projectId: string | null; // the project the signal is about, when there is one
  summary: string;
  evidence: Record<string, unknown>;
};

export type Incident = {
  key: string;
  severity: "high" | "medium" | "low";
  signals: Signal[];
  ballotIds: string[];
  projectIds: string[];
};

const MIN = 60_000;
export const T = {
  networkMin: 5,
  networkWindow: 30 * MIN,
  identicalMin: 4,
  identicalWindow: 15 * MIN,
  freshAge: 10 * MIN,
  freshMin: 3,
  freshWindow: 60 * MIN,
  patternMin: 3,
  surgeSlot: 15 * MIN,
  surgeMin: 5,
  surgeFactor: 4,
  blindMin: 5,
  blindShare: 0.4,
  blindVsBaseline: 2,
};

/** "203.0.113.57" → "203.0.113.0/24"; IPv6 → its /64; IPv4-mapped IPv6 is treated as IPv4. */
export function subnetOf(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/i, "").match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) {
    const addr = ip.split("%")[0]!.toLowerCase();
    const compressed = addr.includes("::");
    const [head = "", tail = ""] = compressed ? addr.split("::") : [addr, ""];
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const groups = compressed ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
    return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
  }
  return null;
}

/** dev.hunter07@outlook.com → "dev.hunter@outlook.com" (digits removed), or null when there were no digits. */
export function addressStem(email: string): string | null {
  const [local = "", domain = ""] = email.toLowerCase().split(/@(?=[^@]*$)/);
  const base = local.split("+")[0]!;
  if (!/\d/.test(base)) return null;
  const stem = base.replace(/\d+/g, "").replace(/[._-]+$/, "");
  return stem.length >= 3 ? `${stem}@${domain}` : null;
}

/** Split a list sorted by time into runs where every item is within `window` of the run's first item. */
function timeClusters<X extends { castAt: Date }>(items: X[], window: number, min: number): X[][] {
  const sorted = [...items].sort((a, b) => a.castAt.getTime() - b.castAt.getTime());
  const out: X[][] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.castAt.getTime() - sorted[i]!.castAt.getTime() <= window) j++;
    const run = sorted.slice(i, j + 1);
    if (run.length >= min) {
      out.push(run);
      i = j + 1;
    } else i++;
  }
  return out;
}

const minutes = (xs: Array<{ castAt: Date }>) =>
  Math.max(1, Math.round((Math.max(...xs.map((x) => x.castAt.getTime())) - Math.min(...xs.map((x) => x.castAt.getTime()))) / MIN));
const slot = (d: Date, size: number) => Math.floor(d.getTime() / size) * size;
const ids = (xs: AbuseBallot[]) => xs.map((b) => b.ballotId).sort();

export function detectSignals(ballots: AbuseBallot[]): Signal[] {
  const cast = ballots.filter((b) => b.choices.length > 0);
  const signals: Signal[] = [];

  // Many ballots from one network in a short time.
  const bySubnet = new Map<string, AbuseBallot[]>();
  for (const b of cast) {
    const net = subnetOf(b.ip);
    if (net) bySubnet.set(net, [...(bySubnet.get(net) ?? []), b]);
  }
  for (const [net, list] of bySubnet)
    for (const run of timeClusters(list, T.networkWindow, T.networkMin))
      signals.push({
        key: `shared_network:${net}:${slot(run[0]!.castAt, T.networkWindow)}`, type: "shared_network", ballotIds: ids(run), projectId: null,
        summary: `${run.length} ballots from the same network (${net}) within ${minutes(run)} minutes.`,
        evidence: { network: net, ballots: run.length, minutes: minutes(run) },
      });

  // Exactly the same picks, in a burst.
  const byPicks = new Map<string, AbuseBallot[]>();
  for (const b of cast) {
    const k = [...b.choices].sort().join(",");
    byPicks.set(k, [...(byPicks.get(k) ?? []), b]);
  }
  for (const [picks, list] of byPicks)
    for (const run of timeClusters(list, T.identicalWindow, T.identicalMin))
      signals.push({
        key: `identical_ballots:${picks}:${slot(run[0]!.castAt, T.identicalWindow)}`, type: "identical_ballots", ballotIds: ids(run),
        projectId: run[0]!.choices.length === 1 ? run[0]!.choices[0]! : null,
        summary: `${run.length} ballots with exactly the same picks within ${minutes(run)} minutes.`,
        evidence: { ballots: run.length, minutes: minutes(run), picks: picks.split(",") },
      });

  // Accounts made just to vote, all for the same project.
  const fresh = cast.filter((b) => b.accountCreatedAt && b.castAt.getTime() - b.accountCreatedAt.getTime() <= T.freshAge);
  const freshByProject = new Map<string, AbuseBallot[]>();
  for (const b of fresh) for (const p of b.choices) freshByProject.set(p, [...(freshByProject.get(p) ?? []), b]);
  for (const [project, list] of freshByProject)
    for (const run of timeClusters(list, T.freshWindow, T.freshMin))
      signals.push({
        key: `fresh_accounts:${project}:${slot(run[0]!.castAt, T.freshWindow)}`, type: "fresh_accounts", ballotIds: ids(run), projectId: project,
        summary: `${run.length} accounts created minutes before voting, all voting for the same project.`,
        evidence: { ballots: run.length, maxAccountAgeMinutes: Math.round(Math.max(...run.map((b) => b.castAt.getTime() - b.accountCreatedAt!.getTime())) / MIN) },
      });

  // Numbered addresses from one pattern.
  const byStem = new Map<string, AbuseBallot[]>();
  for (const b of cast) {
    const stem = b.email ? addressStem(b.email) : null;
    if (stem) byStem.set(stem, [...(byStem.get(stem) ?? []), b]);
  }
  for (const [stem, list] of byStem)
    if (list.length >= T.patternMin)
      signals.push({
        key: `address_pattern:${stem}`, type: "address_pattern", ballotIds: ids(list), projectId: null,
        summary: `${list.length} voters with addresses that differ only by a number (${stem.replace(/^(.)[^@]*/, "$1…")} + digits).`,
        evidence: { pattern: stem, ballots: list.length },
      });

  // Per project: a spike, and votes from people who never opened it.
  const byProject = new Map<string, AbuseBallot[]>();
  for (const b of cast) for (const p of b.choices) byProject.set(p, [...(byProject.get(p) ?? []), b]);
  const blindCount = new Map([...byProject].map(([p, list]) => [p, list.filter((b) => !b.viewed.includes(p)).length]));
  const totalVotes = [...byProject.values()].reduce((s, l) => s + l.length, 0);
  const totalBlind = [...blindCount.values()].reduce((s, n) => s + n, 0);
  for (const [project, list] of byProject) {
    const slots = new Map<number, AbuseBallot[]>();
    for (const b of list) slots.set(slot(b.castAt, T.surgeSlot), [...(slots.get(slot(b.castAt, T.surgeSlot)) ?? []), b]);
    const first = Math.min(...slots.keys());
    const last = Math.max(...slots.keys());
    const span = (last - first) / T.surgeSlot + 1;
    for (const [s, inSlot] of slots) {
      if (inSlot.length < T.surgeMin) continue;
      const rest = list.length - inSlot.length;
      const usual = span > 1 ? rest / (span - 1) : 0; // votes per slot outside this one
      if (inSlot.length >= T.surgeFactor * Math.max(usual, 0.25))
        signals.push({
          key: `surge:${project}:${s}`, type: "surge", ballotIds: ids(inSlot), projectId: project,
          summary:
            usual < 0.1
              ? `${inSlot.length} votes for one project in 15 minutes, when it otherwise gets almost none.`
              : `${inSlot.length} votes for one project in 15 minutes, against a usual ${usual.toFixed(1)} per 15 minutes.`,
          evidence: { votes: inSlot.length, usualPer15Min: Math.round(usual * 10) / 10, at: new Date(s).toISOString() },
        });
    }
    const blind = list.filter((b) => !b.viewed.includes(project));
    const others = totalVotes - list.length;
    const baseline = others > 0 ? (totalBlind - blind.length) / others : 0; // how blind voting is elsewhere
    if (blind.length >= T.blindMin && blind.length / list.length >= Math.max(T.blindShare, T.blindVsBaseline * baseline))
      signals.push({
        key: `blind_votes:${project}`, type: "blind_votes", ballotIds: ids(blind), projectId: project,
        summary: `${blind.length} of ${list.length} votes for this project came from voters who never opened its page.`,
        evidence: { blind: blind.length, total: list.length, blindRateElsewhere: Math.round(baseline * 100) / 100 },
      });
  }
  return signals.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Merge signals that point at mostly the same ballots (overlap ≥ half of the smaller set) into
 * incidents. Severity: 3+ independent kinds of signal → high, 2 → medium, 1 → low.
 */
export function groupIncidents(signals: Signal[]): Incident[] {
  const parent = signals.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const sets = signals.map((s) => new Set(s.ballotIds));
  for (let i = 0; i < signals.length; i++)
    for (let j = i + 1; j < signals.length; j++) {
      let shared = 0;
      for (const id of sets[i]!) if (sets[j]!.has(id)) shared++;
      if (shared >= Math.min(sets[i]!.size, sets[j]!.size) / 2) parent[find(i)] = find(j);
    }
  const groups = new Map<number, Signal[]>();
  signals.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));
  const order = { high: 0, medium: 1, low: 2 };
  return [...groups.values()]
    .map((g) => {
      const kinds = new Set(g.map((s) => s.type)).size;
      return {
        key: g.map((s) => s.key).sort()[0]!, // stable while the incident's earliest signal exists
        severity: (kinds >= 3 ? "high" : kinds === 2 ? "medium" : "low") as Incident["severity"],
        signals: g,
        ballotIds: [...new Set(g.flatMap((s) => s.ballotIds))].sort(),
        projectIds: [...new Set(g.map((s) => s.projectId).filter((p): p is string => !!p))].sort(),
      };
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || b.ballotIds.length - a.ballotIds.length || a.key.localeCompare(b.key));
}
