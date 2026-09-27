// A third demo event, frozen halfway through judging, so a fresh install shows the judging
// engine working: live progress, judges who are behind, a recusal, drafts in flight, and
// the scoring habits normalization exists for (a generous judge, a harsh one, a judge who
// gives everything the same score). Dates are relative to first boot; judging closes two
// days after it. Scores and habits come from a fixed seed; the exact assignments vary with
// the generated IDs, just as they would for a real event.
//
// Log in as judge@dogfood.local (or Cookie: sid=seed-judge-demo) to score the rest live.
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit";
import { planAssignments, rng } from "../judging/assign";
import { ballotOrder, makeReceipt, normalizeEmail } from "../voting/core";

export const JUDGING_DEMO_SLUG = "spring-build-sprint";
export const DEMO_JUDGE_EMAIL = "judge@dogfood.local";
export const DEMO_VOTER_EMAIL = "voter@dogfood.local";

const DAY = 86_400_000;
const MIN = 60_000;

const OVERVIEW = `## Spring Build Sprint

A weekend sprint for small, sharp tools. Submissions have closed and **judging is under way**: eight judges are scoring fifteen projects on a weighted rubric.

### Tracks
- **AI tooling**: models doing useful, checkable work
- **Developer experience**: less waiting, fewer surprises
- **Climate & civic**: software for the commons

Results are normalized across judges before anything is published, so it doesn't matter whether you drew a tough judge or a generous one.`;

const TRACKS = [
  { name: "AI tooling", description: "Models doing useful, checkable work." },
  { name: "Developer experience", description: "Less waiting, fewer surprises." },
  { name: "Climate & civic", description: "Software for the commons." },
];

// title, tagline, track index, tech, how good it actually is (0–1, drives the simulated scores)
const PROJECTS: Array<[string, string, number, string[], number]> = [
  ["Diffwise", "Explains a pull request's risk before anyone reviews it", 0, ["TypeScript", "tree-sitter", "OpenAI API"], 0.86],
  ["Recall", "Semantic search over your team's incident history", 0, ["Python", "pgvector", "FastAPI"], 0.72],
  ["PromptLint", "Static checks for prompt templates in CI", 0, ["Rust", "GitHub Actions"], 0.58],
  ["Tabula", "Turns scanned invoices into clean CSVs, with a confidence per cell", 0, ["Python", "Tesseract", "Svelte"], 0.64],
  ["Critter", "An AI code reviewer that only comments when it's sure", 0, ["Go", "Ollama"], 0.41],
  ["Warmstart", "Dev containers that are ready before you open the laptop", 1, ["Go", "Docker", "systemd"], 0.79],
  ["Flakehunter", "Finds flaky tests by re-running only what changed", 1, ["TypeScript", "Vitest", "SQLite"], 0.9],
  ["Changelogger", "Release notes written from merged PRs, edited by humans", 1, ["Node.js", "Next.js"], 0.52],
  ["Portly", "Never fight over localhost:3000 again", 1, ["Rust"], 0.47],
  ["Envoy Doctor", "Explains why your service mesh config is wrong, in English", 1, ["Go", "Envoy", "React"], 0.66],
  ["GridPulse", "Shifts batch jobs to the hours when the grid is cleanest", 2, ["Python", "Kubernetes", "Electricity Maps"], 0.83],
  ["Open Council", "Searchable minutes and votes for every city council meeting", 2, ["Elixir", "Phoenix", "Whisper"], 0.75],
  ["Treemap", "Crowdsourced street-tree inventory with photo ID", 2, ["Kotlin", "Android", "PostGIS"], 0.55],
  ["Bikeshed", "Where should the next bike lane go? Ask the crash data", 2, ["R", "Shiny", "OpenStreetMap"], 0.61],
  ["Repair Café Finder", "Fix it instead of binning it, with a map of who can help", 2, ["Vue", "Supabase"], 0.37],
];

const PEOPLE = [
  "Amara Singh", "Lukas Brandt", "Sofia Ricci", "Mateo Álvarez", "Hana Kobayashi", "Noah Fischer", "Zainab Yusuf", "Oliver Grant",
  "Mei Lin", "Tomás Silva", "Leila Haddad", "Jonas Berg", "Priya Raman", "Kofi Mensah", "Elena Petrova", "Samir Khan",
  "Chloé Martin", "Diego Santos", "Ingrid Olsen", "Yusuf Demir", "Ana Costa", "Felix Wagner", "Nia Roberts", "Ravi Iyer",
  "Maja Nowak", "Arjun Mehta", "Clara Jensen", "Emeka Obi", "Lina Sato", "Pablo Ruiz",
];

type Profile = "done" | "most" | "behind" | "idle" | "half" | "demo";
// bias shifts every score; flat = gives the same score to everything; minutes = time per review
const JUDGES: Array<{ name: string; email: string; tracks: number[]; profile: Profile; bias: number; flat?: number; minutes: [number, number] }> = [
  { name: "Ava Moreau", email: "ava.moreau@judges.example.org", tracks: [], profile: "done", bias: 1.6, minutes: [8, 20] },
  { name: "Ben Okafor", email: "ben.okafor@judges.example.org", tracks: [0, 1], profile: "done", bias: -1.7, minutes: [10, 25] },
  { name: "Chen Wei", email: "chen.wei@judges.example.org", tracks: [1, 2], profile: "most", bias: 0.2, minutes: [7, 18] },
  { name: "Dana Kowalski", email: "dana.kowalski@judges.example.org", tracks: [0], profile: "behind", bias: 0.6, minutes: [12, 30] },
  { name: "Eli Navarro", email: "eli.navarro@judges.example.org", tracks: [2], profile: "idle", bias: 0, minutes: [10, 20] },
  { name: "Farah Haddad", email: "farah.haddad@judges.example.org", tracks: [], profile: "done", bias: 0, flat: 7, minutes: [0.5, 1.8] },
  { name: "Gus Lindqvist", email: "gus.lindqvist@judges.example.org", tracks: [0, 2], profile: "half", bias: -0.6, minutes: [9, 22] },
  { name: "Jordan Lee", email: DEMO_JUDGE_EMAIL, tracks: [], profile: "demo", bias: 0.3, minutes: [6, 15] },
];

const CRITERIA = [
  { key: "functionality", label: "Functionality", description: "Does it work end to end? How complete is it for a weekend?", weight: 35 },
  { key: "technical_depth", label: "Technical depth", description: "How hard was the engineering, and how well was it done?", weight: 25 },
  { key: "originality", label: "Originality", description: "A new idea, or a familiar one done in a new way?", weight: 20 },
  { key: "presentation", label: "Presentation", description: "Can we understand it from the page, the demo and the README?", weight: 20 },
];

// A second sentence per review, so no two reviews read the same (real judges don't paste).
const ASPECTS = [
  "The onboarding could be one step shorter.",
  "Error messages were clear when I broke things.",
  "I'd like to see how it behaves with real data.",
  "The architecture diagram in the README helped.",
  "Tests exist, which is rare for a weekend build.",
  "The demo video covers the main flow well.",
  "Scope was sensible for the time available.",
  "Accessibility needs another pass.",
  "Performance felt fine on my laptop.",
];

const COMMENTS = {
  high: ["Worked first time and the README walks you through it. Would use this.", "Impressive scope for a weekend, and the demo shows the hard part.", "Clear problem, clean solution, great demo."],
  mid: ["Solid idea; the demo covers the happy path only.", "Works, but setup took a while. The core is promising.", "Nice execution, though the idea isn't new."],
  low: ["Couldn't get it running from the README.", "Early prototype; most of the features are mocked.", "Hard to tell what it does from the page."],
};

const slugEmail = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") + "@sprint.example.org";

export async function seedJudgingDemo(prisma: PrismaClient, organizerId: string, demoPasswordHash: string | null) {
  if (await prisma.event.findUnique({ where: { slug: JUDGING_DEMO_SLUG } })) return;
  const random = rng(20260927);
  const between = (lo: number, hi: number) => lo + random() * (hi - lo);
  const now = Date.now();
  const hour = (days: number) => new Date(Math.floor((now + days * DAY) / 3_600_000) * 3_600_000);
  const judgingOpens = hour(-2);

  await prisma.$transaction(
    async (tx) => {
      const e = await tx.event.create({
        data: {
          slug: JUDGING_DEMO_SLUG,
          name: "Spring Build Sprint",
          tagline: "Small, sharp tools. Judging in progress.",
          description: "A finished hackathon halfway through judging.",
          location: "Online",
          overview: OVERVIEW,
          rules: "Teams of 1–3. One project per team. Scores are normalized across judges before results are published.",
          registrationOpensAt: hour(-10),
          submissionsOpenAt: hour(-5),
          submissionsCloseAt: judgingOpens,
          judgingOpensAt: judgingOpens,
          judgingClosesAt: hour(2),
          maxTeamSize: 3,
          // A People's Choice vote runs alongside judging: verified email, 3 votes each.
          votingOpensAt: judgingOpens,
          votingClosesAt: hour(2),
          votingMode: "email",
          votesPerVoter: 3,
        },
      });
      await tx.eventRole.create({ data: { eventId: e.id, userId: organizerId, role: "organizer" } });
      const tracks = await Promise.all(TRACKS.map((t) => tx.track.create({ data: { eventId: e.id, ...t } })));
      await tx.prize.createMany({
        data: [
          { eventId: e.id, name: "Best overall", value: "$750", rank: 1 },
          { eventId: e.id, name: "Runner-up", value: "$350", rank: 2 },
          ...tracks.map((t) => ({ eventId: e.id, trackId: t.id, name: `Best in ${t.name}`, value: "$150" })),
        ],
      });
      const criteria = await Promise.all(CRITERIA.map((c, i) => tx.criterion.create({ data: { eventId: e.id, ...c, minScore: 1, maxScore: 10, position: i } })));

      // Participants, teams and submitted projects.
      let person = 0;
      const projects: Array<{ id: string; title: string; trackId: string | null; teamId: string; quality: number }> = [];
      for (const [i, [title, tagline, track, tech, quality]] of PROJECTS.entries()) {
        const size = 1 + (i % 3);
        const members = [];
        for (let m = 0; m < size; m++) {
          const name = PEOPLE[person++ % PEOPLE.length]!;
          const email = slugEmail(name);
          members.push(await tx.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash: demoPasswordHash } }));
        }
        const team = await tx.team.create({ data: { eventId: e.id, name: title, createdById: members[0]!.id } });
        for (const [m, u] of members.entries()) {
          await tx.eventRole.create({ data: { eventId: e.id, userId: u.id, role: "participant" } });
          await tx.teamMember.create({ data: { teamId: team.id, eventId: e.id, userId: u.id, role: m === 0 ? "captain" : "member" } });
        }
        const submittedAt = new Date(judgingOpens.getTime() - between(1, 30) * 3_600_000);
        const project = await tx.project.create({
          data: {
            eventId: e.id, teamId: team.id, trackId: tracks[track]!.id, title, tagline, techTags: tech, status: "submitted", submittedAt,
            description: `## What it does\n${tagline}.\n\n## How we built it\nBuilt over the weekend with ${tech.join(", ")}.\n\n## What's next\nMore tests, a proper onboarding flow, and a hosted demo.`,
            repoUrl: `https://github.com/example/${title.toLowerCase().replace(/[^a-z]+/g, "-")}`,
            demoUrl: i % 2 === 0 ? `https://${title.toLowerCase().replace(/[^a-z]+/g, "")}.example.org` : null,
          },
        });
        projects.push({ ...project, teamId: team.id, quality });
      }

      // Judges.
      const judges = [];
      for (const j of JUDGES) {
        const user = await tx.user.upsert({ where: { email: j.email }, update: {}, create: { email: j.email, name: j.name, passwordHash: demoPasswordHash } });
        await tx.eventRole.create({ data: { eventId: e.id, userId: user.id, role: "judge" } });
        if (j.tracks.length) await tx.judgeTrack.createMany({ data: j.tracks.map((t) => ({ eventId: e.id, userId: user.id, trackId: tracks[t]!.id })) });
        judges.push({ ...j, id: user.id });
      }

      // Assign with the real engine, exactly as an organizer would.
      const seed = 2026;
      const plan = planAssignments({
        projects: projects.map((p) => ({ id: p.id, trackId: p.trackId, teamId: p.teamId })).sort((a, b) => a.id.localeCompare(b.id)),
        judges: judges.map((j) => ({ id: j.id, trackIds: j.tracks.map((t) => tracks[t]!.id).sort() })).sort((a, b) => a.id.localeCompare(b.id)),
        existing: [], blocked: [], conflicts: [], reviewsPerProject: 3, maxPerJudge: null, seed,
      });
      const batch = await tx.assignmentBatch.create({
        data: { eventId: e.id, name: "Auto-assign · 3 per project", algorithm: "balanced-greedy-v1", params: { reviewsPerProject: 3, maxPerJudge: null }, seed, createdById: organizerId, createdAt: judgingOpens },
      });

      // Each judge works through their queue according to their profile.
      const byId = new Map(projects.map((p) => [p.id, p]));
      const counts = { submitted: 0, drafts: 0, recused: 0 };
      for (const j of judges) {
        const mine = plan.assignments.filter((a) => a.judgeId === j.id).map((a) => byId.get(a.projectId)!).sort((a, b) => a.title.localeCompare(b.title));
        // Spread each judge's work across the time judging has been open.
        const from = judgingOpens.getTime() + 3_600_000;
        const span = now - 30 * MIN - from;
        for (const [i, p] of mine.entries()) {
          const n = mine.length;
          const status =
            j.profile === "done" ? "submitted"
            : j.profile === "most" ? (i < n - 1 ? "submitted" : "in_progress")
            : j.profile === "behind" ? (i === 0 ? "submitted" : "assigned")
            : j.profile === "idle" ? "assigned"
            : j.profile === "half" ? (i === n - 1 ? "recused" : i < Math.floor(n / 2) ? "submitted" : "assigned")
            : i < 3 ? "submitted" : "assigned";

          const minutes = between(...j.minutes);
          const submittedAt = new Date(from + span * ((i + between(0.15, 0.85)) / n));
          const openedAt = status === "assigned" && !(j.profile === "behind" && i === 1) ? null : new Date(submittedAt.getTime() - minutes * MIN);

          const assignment = await tx.assignment.create({
            data: {
              eventId: e.id, batchId: batch.id, judgeId: j.id, projectId: p.id, status, openedAt, createdAt: judgingOpens,
              recusalReason: status === "recused" ? "I mentored this team during the event." : null,
            },
          });
          if (status === "recused") {
            await tx.conflictOfInterest.create({ data: { eventId: e.id, judgeId: j.id, teamId: p.teamId, source: "declared", note: "I mentored this team during the event." } });
            counts.recused++;
            continue;
          }
          if (status !== "submitted" && status !== "in_progress") continue;

          const composite = 1 + p.quality * 8.5;
          // Two planted problems for the integrity checks: Ava's first review says the project
          // didn't run but scores it near the top, and Gus's first review is far below everyone else's.
          const planted = i === 0 && status === "submitted" ? (j.name === "Ava Moreau" ? "mismatch" : j.name === "Gus Lindqvist" ? "outlier" : null) : null;
          const values = criteria.map((c, k) =>
            planted === "mismatch" ? (k === 2 ? 8 : 9)
            : planted === "outlier" ? 1
            : j.flat ?? Math.max(1, Math.min(10, Math.round(composite + j.bias + (k === 2 ? (p.quality - 0.5) * 2 : 0) + between(-1.1, 1.1)))),
          );
          const band = composite + j.bias >= 7 ? "high" : composite + j.bias >= 4.5 ? "mid" : "low";
                    const comment =
            planted === "mismatch" ? "Didn't run for me and the docs are thin."
            : planted === "outlier" ? "Not for me."
            : `${COMMENTS[band][Math.floor(random() * 3)]!} ${ASPECTS[(PROJECTS.findIndex(([t]) => t === p.title) + JUDGES.indexOf(JUDGES.find((x) => x.email === j.email)!)) % ASPECTS.length]!}`;
          const draft = status === "in_progress";
          const review = await tx.review.create({
            data: {
              assignmentId: assignment.id, eventId: e.id, judgeId: j.id, projectId: p.id,
              status: draft ? "draft" : "submitted", submittedAt: draft ? null : submittedAt, comment: draft ? "" : comment,
              createdAt: openedAt!, updatedAt: submittedAt,
            },
          });
          await tx.reviewScore.createMany({
            data: criteria.slice(0, draft ? 2 : criteria.length).map((c, k) => ({ reviewId: review.id, criterionId: c.id, value: values[k]! })),
          });
          if (draft) counts.drafts++;
          else counts.submitted++;
        }
      }

      // Community voters. Three kinds, so the anti-abuse review has something real to do:
      //   34 ordinary fans: old accounts, their own networks, spread over two days, and they
      //      opened the projects they voted for;
      //   6 students voting together from one campus network: flagged, but only as low severity,
      //      which an organizer should look at and mark as fine;
      //   12 throwaway accounts (dev.hunter01..12@outlook.com), created minutes before voting, on
      //      one /24, all backing Portly within four minutes, none of them having opened it:
      //      six independent signals, one high-severity incident.
      // Every ballot is cast through the same shuffled order a real voter sees.
      const ballotIds = projects.map((p) => p.id);
      const FIRST = ["maya", "leo", "ines", "omar", "zoe", "ravi", "nora", "felix", "aiko", "sam", "tara", "yusuf", "lena", "diego", "chloe", "arjun", "mira"];
      const LAST = ["okafor", "berg", "silva", "khan", "moreau", "tanaka", "novak", "reyes", "lund", "patel", "cho", "haddad"];
      const DOMAINS = ["gmail.com", "outlook.com", "proton.me", "fastmail.com", "hey.com", "icloud.com"];
      let ballots = 0;
      const castBallot = async (o: { email: string; name: string; accountAt: Date; castAt: Date; ip: string; picks: string[]; viewed: string[] }) => {
        const user = await tx.user.upsert({ where: { email: o.email }, update: {}, create: { email: o.email, name: o.name, emailVerifiedAt: o.accountAt, passwordHash: demoPasswordHash, createdAt: o.accountAt } });
        const identityKey = `user:${user.id}`;
        const order = ballotOrder(ballotIds, `${e.id}:${identityKey}`);
        const voter = await tx.voter.create({ data: { eventId: e.id, kind: "email", userId: user.id, identityKey, emailKey: normalizeEmail(o.email), ip: o.ip, userAgent: "Mozilla/5.0 (seed)", createdAt: o.castAt } });
        const ballot = await tx.ballot.create({ data: { eventId: e.id, voterId: voter.id, receipt: makeReceipt(), ip: o.ip, userAgent: voter.userAgent, createdAt: o.castAt, updatedAt: o.castAt } });
        await tx.ballotChoice.createMany({ data: o.picks.map((projectId) => ({ ballotId: ballot.id, projectId, position: order.indexOf(projectId), createdAt: o.castAt })) });
        if (o.viewed.length)
          await tx.projectView.createMany({ data: o.viewed.map((projectId) => ({ eventId: e.id, projectId, viewerKey: identityKey, firstViewedAt: new Date(o.castAt.getTime() - 5 * MIN) })), skipDuplicates: true });
        ballots++;
        return user;
      };
      const appealPicks = (n: number) => projects.map((p) => ({ id: p.id, w: p.quality + between(-0.35, 0.35) })).sort((a, b) => b.w - a.w).slice(0, n).map((x) => x.id);
      const alsoLooked = () => projects.filter(() => random() < 0.25).map((p) => p.id);

      const fans: Array<{ id: string; name: string }> = [];
      for (let v = 0; v < 34; v++) {
        const first = FIRST[v % FIRST.length]!;
        const last = LAST[(v * 5) % LAST.length]!;
        const picks = appealPicks(1 + (v % 3));
        const fan = await castBallot({
          email: `${first}.${last}@${DOMAINS[v % DOMAINS.length]}`,
          name: `${first[0]!.toUpperCase()}${first.slice(1)} ${last[0]!.toUpperCase()}${last.slice(1)}`,
          accountAt: new Date(judgingOpens.getTime() - between(5, 400) * DAY / 10),
          castAt: new Date(judgingOpens.getTime() + between(0.5, 44) * 3_600_000),
          ip: `100.64.${10 + v * 3}.${20 + v}`,
          picks,
          viewed: [...picks, ...alsoLooked()],
        });
        fans.push(fan);
      }

      const campusAt = judgingOpens.getTime() + 20 * 3_600_000;
      for (let v = 0; v < 6; v++) {
        const first = FIRST[(v * 3 + 1) % FIRST.length]!;
        const picks = appealPicks(3).slice(v % 2, (v % 2) + 1 + (v % 3));
        await castBallot({
          email: `${first}.${LAST[(v + 7) % LAST.length]}@students.uni.example.edu`,
          name: `${first[0]!.toUpperCase()}${first.slice(1)} (student)`,
          accountAt: new Date(campusAt - between(20, 90) * DAY),
          castAt: new Date(campusAt + v * 4 * MIN + between(0, 2) * MIN),
          ip: `192.0.2.${30 + v * 7}`,
          picks,
          viewed: [...picks, ...alsoLooked()],
        });
      }

      const portly = projects.find((p) => p.title === "Portly")!.id;
      const ringAt = Math.min(now - 5 * 3_600_000, judgingOpens.getTime() + 30 * 3_600_000);
      const ring: Array<{ id: string; name: string }> = [];
      for (let v = 0; v < 12; v++) {
        const castAt = new Date(ringAt + v * 20_000);
        const member = await castBallot({
          email: `dev.hunter${String(v + 1).padStart(2, "0")}@outlook.com`,
          name: `Dev Hunter ${v + 1}`,
          accountAt: new Date(castAt.getTime() - between(1, 3) * MIN),
          castAt,
          ip: `203.0.113.${40 + v}`,
          picks: [portly],
          viewed: [],
        });
        ring.push(member);
      }

      // A discussion: questions answered by the teams, a link from an established fan, and the
      // ring's vote-begging spam on Portly, reported twice and waiting in the moderation queue.
      const byTitle = new Map(projects.map((p) => [p.title, p]));
      const captainOf = async (title: string) =>
        (await tx.teamMember.findFirstOrThrow({ where: { teamId: byTitle.get(title)!.teamId, role: "captain" }, select: { userId: true } })).userId;
      const say = async (title: string, authorId: string, body: string, hoursIn: number, parentId: string | null = null) =>
        tx.comment.create({
          data: { eventId: e.id, projectId: byTitle.get(title)!.id, authorId, parentId, body, createdAt: new Date(judgingOpens.getTime() + hoursIn * 3_600_000) },
        });
      const q1 = await say("Flakehunter", fans[0]!.id, "How do you decide a test is flaky rather than genuinely broken? Is it just re-running N times?", 3);
      await say("Flakehunter", await captainOf("Flakehunter"), "Three re-runs on the same commit, plus a check that the failure isn't tied to the diff. The thresholds are configurable in flakehunter.toml.", 4.5, q1.id);
      await say("Flakehunter", fans[4]!.id, "Ran it on our monorepo over lunch: it found 11 flaky tests we'd been ignoring for months. Great work.", 9);
      const q2 = await say("GridPulse", fans[7]!.id, "Which grid-intensity data do you use offline? The demo seemed to work without a network.", 6);
      await say("GridPulse", await captainOf("GridPulse"), "We ship a cached week of forecasts per region and refresh when online. Worst case you schedule on a day-old forecast.", 7.2, q2.id);
      await say("Diffwise", fans[2]!.id, "The risk summary on our PR was spot on. For anyone curious, the write-up is at https://example.org/diffwise-notes", 12);
      await say("Open Council", fans[10]!.id, "Would love a way to subscribe to a single agenda topic. Is that on the roadmap?", 15);
      const spam = await say("Portly", ring[0]!.id, "VOTE PORTLY!!! best project here, everyone go vote now at portly-wins.xyz", 30.2);
      for (const reporter of [fans[1]!, fans[5]!])
        await tx.commentReport.create({ data: { commentId: spam.id, reporterId: reporter.id, reason: "spam", note: "vote-begging with a link", createdAt: new Date(spam.createdAt.getTime() + 20 * MIN) } });
      // A verified voter who hasn't voted yet, for trying the ballot live (Cookie: sid=seed-voter).
      await tx.user.upsert({
        where: { email: DEMO_VOTER_EMAIL },
        // The showcase seed may have created this voter first (for the sample event's vote).
        update: { passwordHash: demoPasswordHash, emailVerifiedAt: judgingOpens },
        create: { email: DEMO_VOTER_EMAIL, name: "Riley Voter", emailVerifiedAt: judgingOpens, passwordHash: demoPasswordHash },
      });

      await appendAudit(tx, {
        eventId: e.id, actorLabel: "system:seed", action: "event.create", entityType: "Event", entityId: e.id,
        after: { slug: e.slug, demo: true, projects: projects.length, judges: judges.length, assignments: plan.assignments.length, ...counts, ballots },
      });
    },
    { timeout: 120_000 },
  );
}
