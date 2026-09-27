// Demo content so a fresh install looks like a real platform: the fixture event gets an
// overview, rules and prizes (the fixture file has none), and a live "demo" event is
// created with dates relative to first boot so there is always something open.
// Only fills gaps: nothing an organizer has edited is overwritten.
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit";

const DAY = 86_400_000;

const SAMPLE_OVERVIEW = `## About Sample Hack 2026

Forty teams, eight tracks, one weekend. This is the shared dataset every DOGFOOD portal loads, so judges can compare platforms rather than demo data.

### What made it interesting
- **Eight tracks**, from developer tools to open hardware
- **Thirty judges**, each reviewing inside their own tracks
- A few awkward cases on purpose: a judge who scores everything the same, review batches nobody finished, and one duplicate submission

Submissions are closed. Browse the **Projects** tab to see what was built.`;

const RULES = `### Eligibility
- Teams of 1–4 people. Everyone on a team must register.
- All code must be written during the hacking window.

### Submissions
- One project per team. Drafts can be edited until the deadline, and so can submitted projects.
- A submission needs a name, tagline, description, repository link and track.

### Judging
- Projects are scored on a weighted rubric. Judges score independently and never see each other's scores.
- Scores are normalized across judges before ranking, so a harsh or generous judge can't swing the result.

### Conduct
Be kind. Harassment of any kind gets you removed from the event.`;

const DEMO_OVERVIEW = `## Build something your future self will use

**Dogfood Demo Jam** is a 72-hour online hackathon for tools that make everyday engineering calmer: better on-call, clearer docs, faster reviews.

### How it works
1. **Register** and create a team (or go solo).
2. **Invite teammates** with a link or by email.
3. **Submit** before the deadline. You can keep editing until the clock runs out.

### Who should join
Developers, designers and data people. Beginners are welcome; half the fun is shipping something you didn't know how to build on Friday.`;

export async function seedShowcase(prisma: PrismaClient, sampleEventId: string, organizerId: string) {
  const sample = await prisma.event.findUniqueOrThrow({ where: { id: sampleEventId } });
  if (!sample.overview) {
    await prisma.event.update({
      where: { id: sample.id },
      data: {
        tagline: sample.tagline || "The shared dataset: 40 projects, 30 judges, 8 tracks",
        description: sample.description === "Imported from fixtures.json." ? "Forty teams, eight tracks, one weekend." : sample.description,
        overview: SAMPLE_OVERVIEW,
        rules: sample.rules || RULES,
      },
    });
  }
  if ((await prisma.prize.count({ where: { eventId: sample.id } })) === 0) {
    await prisma.prize.createMany({
      data: [
        { eventId: sample.id, name: "Grand prize", value: "$1,200", rank: 1, description: "The project the judges would run in production tomorrow." },
        { eventId: sample.id, name: "Runner-up", value: "$600", rank: 2 },
        { eventId: sample.id, name: "Third place", value: "$300", rank: 3 },
        { eventId: sample.id, name: "Best judging engine", value: "$100", rank: 4, description: "Most defensible assignment and normalization." },
      ],
    });
  }

  if (await prisma.event.findUnique({ where: { slug: "dogfood-demo-jam" } })) return;
  const now = Date.now();
  const at = (days: number) => new Date(Math.floor((now + days * DAY) / 3_600_000) * 3_600_000);
  await prisma.$transaction(async (tx) => {
    const e = await tx.event.create({
      data: {
        slug: "dogfood-demo-jam",
        name: "Dogfood Demo Jam",
        tagline: "72 hours to build the tools you wish you had",
        description: "A live demo event: register, form a team and submit.",
        location: "Online",
        overview: DEMO_OVERVIEW,
        rules: RULES,
        registrationOpensAt: at(-3),
        submissionsOpenAt: at(-1),
        submissionsCloseAt: at(2),
        judgingOpensAt: at(2),
        judgingClosesAt: at(9),
        maxTeamSize: 4,
      },
    });
    await tx.eventRole.create({ data: { eventId: e.id, userId: organizerId, role: "organizer" } });
    await tx.track.createMany({
      data: [
        { eventId: e.id, name: "Developer experience", description: "Faster builds, clearer errors, calmer reviews." },
        { eventId: e.id, name: "On-call & reliability", description: "Make 3am pages rarer and shorter." },
        { eventId: e.id, name: "Docs & knowledge", description: "Help teams find what they already know." },
        { eventId: e.id, name: "Open track", description: "Anything that doesn't fit the others." },
      ],
    });
    await tx.prize.createMany({
      data: [
        { eventId: e.id, name: "Best overall", value: "$1,000", rank: 1, description: "Plus a feature on the Hackathon Raptors blog." },
        { eventId: e.id, name: "Runner-up", value: "$500", rank: 2 },
        { eventId: e.id, name: "Best first-time hackers", value: "$250", rank: 3 },
      ],
    });
    await tx.criterion.createMany({
      data: [
        { eventId: e.id, key: "functionality", label: "Functionality", description: "Does it work? How complete is it for a hackathon build?", weight: 30, position: 0 },
        { eventId: e.id, key: "technical_depth", label: "Technical depth", description: "How hard was the engineering, and how well was it done?", weight: 25, position: 1 },
        { eventId: e.id, key: "innovation", label: "Innovation", description: "Is the idea or approach new?", weight: 20, position: 2 },
        { eventId: e.id, key: "impact", label: "Impact", description: "Would real people use this?", weight: 15, position: 3 },
        { eventId: e.id, key: "presentation", label: "Presentation", description: "Can we understand it from the page, demo and README?", weight: 10, position: 4 },
      ],
    });
    await tx.submissionQuestion.createMany({
      data: [
        { eventId: e.id, label: "How far did you get?", type: "single_select", options: ["Idea", "Prototype", "Working product"], required: true, position: 0 },
        { eventId: e.id, label: "Anything judges should try first?", type: "long_text", help: "A login, a demo path, a known bug.", position: 1 },
        { eventId: e.id, label: "I confirm our code was written during the event", type: "checkbox", required: true, isPublic: false, position: 2 },
      ],
    });
    await appendAudit(tx, { eventId: e.id, actorLabel: "system:seed", action: "event.create", entityType: "Event", entityId: e.id, after: { slug: e.slug, demo: true } });
  });
}
