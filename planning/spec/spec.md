# DOGFOOD 2026 spec

You are building a submission and judging platform for hackathons. The website tells you what the tiers are, how scoring is weighted, what the prizes are and what the rules are. Read it first if you have not.

This document is the other half: the small number of things your project has to agree on with ours, so that a program can check your work and a judge can compare your portal to someone else's.

It is short on purpose. Almost nothing here is a restriction.

---

## How a weekend actually goes

Meet Priya, Tom and Wei. Three people, one team, and none of them has done this before.

**Wednesday.** They read the website and this page. They pick T1 and T2 as a realistic target. Tom sketches a database schema on paper. Wei picks Django because he knows it. Nobody writes project code yet, because the rules say new code only, starting Friday.

**Thursday.** They download everything from this page. `run.py` is one short file, so they read it and now know exactly what will be checked. `fixtures.json` is a pile of fake hackathon data: forty projects, thirty judges, eight tracks. Priya sketches a schema against the real records instead of guessing at them.

**Friday 18:00 UTC.** Kickoff. Nothing new appears, because nothing was held back. The clock simply starts, and they begin writing code.

**Friday to Monday.** They build. Auth, events, teams, submissions, a gallery. Then judge assignment and a scoring form. It works on Wei's laptop.

**Sunday afternoon.** Time to check their work. They start the portal:

```
docker compose up
```

It boots, loads the fixtures, and prints something they did not expect to care about:

```
seeded. test logins:
  organizer    Cookie: session=org_7f2a
  judge_a      Cookie: session=jdg_a_91bc
  judge_b      Cookie: session=jdg_b_44de
  participant  Cookie: session=prt_2e88
```

Priya copies those into a file called `.dogfood.toml` at the root of their repo, along with the handful of routes the checker needs to know about. Six minutes of work. Then:

```
python3 run.py .dogfood.toml
```

And the output:

```
T1  gallery is public ................. PASS
T1  project from fixtures shown ....... PASS
T1  closed event refuses submissions .. PASS
T2  judge sees own scores ............. PASS
T2  judge cannot see peer scores ...... FAIL
       GET http://localhost:8080/api/judge/scores?judge=judge_a
       sent as judge_b; this is the url that returns judge_a's scores
       got 200, wanted 401 or 403
       the backend returned another judge's scores
T2  participant blocked ............... PASS
T2  csv export works .................. PASS

claimed T1 T2, verified T1
note: claimed but not verified: T2
```

Ouch. Their judge page hides the other judge's scores in the template, but the API happily returns them to anyone logged in. That is the difference between hiding a button and refusing a request. Tom moves the check into the view, one `if` statement, and reruns. All green.

**Sunday 18:00 UTC.** They save the output to `acceptance-report.txt`, commit it, and submit.

That is the whole mechanism. The rest of this page is detail on the four files that appeared in that story.

---

## The tiers, in one line each

The website has the full version. This is the pocket copy.

- **T1 core.** Login, roles, create an event, form a team, submit a project, edit it until the deadline, deadline actually stops submissions, public gallery.
- **T2 judging.** Invite and assign judges, a scoring rubric the organizer can weight, judges cannot see each other's work, a progress view for the organizer, a documented way to even out judges who score harshly or generously, CSV export.
- **T3 public.** Community voting, comments, results hidden until the window closes, ballots in random order, and an answer to people trying to cheat it.
- **T4 stretch.** REST API, webhooks, certificates, verifiable judge records, an embeddable gallery, bulk import and export.

T1 is the floor. A clean T2 beats a broken T4, because correctness is worth more than breadth in the scoring.

---

## File 1: `.dogfood.toml`

**What it is.** Six to fifteen lines at the root of your repo that tell the checker where things are in your portal.

**Why it exists.** Forty teams are building forty different portals. Some will be Django, some Rails, some Next.js, some Go. If we demanded that everyone expose `/api/v1/projects` with a fixed JSON shape, we would be designing your API for you, and that is your work, not ours.

So we do the opposite. Build whatever you want, call your routes whatever you want, and then write down where they ended up.

```toml
[portal]
base_url = "http://localhost:8080"

[tiers]
claimed = ["T1", "T2"]
pitch = "One sentence on what you built."

[auth]
# Whatever header proves you are this role. A cookie, a
# bearer token, a basic auth string. Your seed script
# prints these when the portal boots.
organizer   = "Cookie: session=org_7f2a"
judge_a     = "Cookie: session=jdg_a_91bc"
judge_b     = "Cookie: session=jdg_b_44de"
participant = "Cookie: session=prt_2e88"

[routes]
gallery      = "/projects"
submit       = "/projects/new"
judge_scores = "/api/judge/scores"
peer_scores  = "/api/judge/scores?judge=judge_a"
csv_export   = "/api/export.csv"
```

**The checker never logs in.** Logging in is the single thing no two stacks do alike: form posts, JSON posts, session cookies, bearer tokens, OAuth. Rather than pick one and force it on everyone, we ask you to hand over a working header and we attach it. Your login page can work however you like.

**`claimed` is on your honour, and it is checked.** Put down the tiers you believe you finished. The checker prints what it could verify next to what you claimed. Claiming T2 and verifying T1 scores as T1. Claiming T1 and verifying T1 is a clean result. Saying you got further than you did is the one thing that actually costs you points, so do not.

`peer_scores` deserves a word. It is the url that, in your portal, would return judge A's scores. Maybe that is a query parameter, maybe it is `/api/judges/jdg_01/scores`, maybe something else. You write it down and the checker visits it as judge B, who should be turned away. We ask you for the url rather than dictating one, because your API is yours.

Two judge headers are required for the same reason: one of the checks needs judge B to go looking at judge A's work.

---

## File 2: `fixtures.json`

**What it is.** A file of invented hackathon data that every team loads into their portal.

**Why it exists.** If everyone seeds their own demo data, a judge opening two portals is comparing test data, not software. One team seeds three tidy projects, another seeds forty messy ones, and the tidy one looks better for no good reason. With shared fixtures, every portal holds the same forty projects, so the only thing that differs is what you built.

It also contains the awkward cases on purpose. A judge who gave every single project the same score. Two review batches that were never finished. A duplicate submission. These are real things that happen at real hackathons, and how your portal copes with them is interesting.

**It is already downloadable.** Nothing on this page is held back until kickoff. The shape below is a three record sample so you can read it at a glance; the real file has all forty projects and every awkward case in it, and you can have it now.

```json
{
  "event": {
    "id": "evt_01",
    "name": "Sample Hack 2026",
    "submissions_close": "2026-03-01T18:00:00Z"
  },
  "tracks": [
    { "id": "trk_01", "name": "Developer tools" }
  ],
  "judges": [
    { "id": "jdg_01", "name": "Ada Okonkwo",
      "email": "ada@example.org", "tracks": ["trk_01"] }
  ],
  "teams": [
    { "id": "tm_01", "name": "Nightshift",
      "members": ["ada@example.org"] }
  ],
  "projects": [
    { "id": "prj_01", "team": "tm_01", "track": "trk_01",
      "title": "Quiet Hours", "summary": "One line.",
      "repo_url": "https://example.org/repo",
      "submitted_at": "2026-02-28T22:14:00Z" }
  ],
  "scores": [
    { "judge": "jdg_01", "project": "prj_01",
      "criteria": { "functionality": 4, "quality": 3 },
      "comment": "Text, sometimes empty." }
  ]
}
```

Every id is a string. Every timestamp is ISO 8601 in UTC. Some `scores` entries are missing on purpose, because not every judge finishes every batch. Your portal should not fall over when a project has two reviews and its neighbour has five.

You do not have to store it in this shape. Load it, transform it, put it in whatever schema you can defend. The file is input, not your data model.

---

## File 3: the acceptance suite

**What it is.** One Python file, `run.py`, that you point at your `.dogfood.toml`.

**Why it exists.** Tier completion is the largest single piece of your score. Rather than a judge reading your README and taking your word for it, a program makes some requests to your running portal and reports what happened. It is the same program for every team, so nobody is judged more strictly than anybody else.

**How to run it:**

```
python3 run.py .dogfood.toml
```

Any Python 3, including the one already on your Mac or in your container. Standard library only, nothing to install. It makes plain HTTP requests to your `base_url` and prints a line per check.

Keep `fixtures.json` next to `run.py` and it will find it. If you keep it somewhere else, pass the path with the `fixtures` option. The checker prints which file it loaded, so you can see at a glance whether it found the right one.

**What it checks.** Seven things, all of them behaviour you were building anyway. Each is written below as a sentence first, then the request.

### T1

A stranger can browse the gallery.

```
GET {base_url}{routes.gallery}
no auth header
expect 200
```

The gallery shows projects from the fixture data.

```
GET {base_url}{routes.gallery}
expect the title of a known fixture project in the response body
```

A closed event refuses submissions.

```
POST a project as {auth.participant} to {routes.submit}
expect 4xx
```

The fixture event's `submissions_close` is a date in the past, so if you seeded honestly your portal is already closed and this post has to be refused. That is the whole check: it does not manipulate a clock, and it does not inspect why you refused. Seed with the fixture's close date rather than one of your own and this passes on the first try.

### T2

A judge can read their own scores.

```
GET {base_url}{routes.judge_scores}
with {auth.judge_a}
expect 200
```

**A judge cannot read another judge's scores.** This is the one that matters most.

```
GET {base_url}{routes.peer_scores}
with {auth.judge_b}
expect 401 or 403
```

Hiding the other judge's scores in your template is not refusing. The check has to live in the backend, because the backend is where curl arrives. If a logged in judge can get another judge's numbers by typing a URL, the isolation is decorative. This is the most common way a good looking project loses points, and it takes one `if` statement to get right.

A participant is not a judge.

```
GET {base_url}{routes.judge_scores}
with {auth.participant}
expect 401 or 403
```

An organizer can export results as CSV.

```
GET {base_url}{routes.csv_export}
with {auth.organizer}
expect 200 and a CSV body
```

That is it. The checker does not look at your HTML, your framework, your database, your file layout or your commit history.

---

## File 4: `acceptance-report.txt`

**What it is.** The output of the checker, saved to a file and committed to your repo.

**Why it exists.** It is your receipt. A judge opens it and knows in five seconds what runs.

**How to make it.** Redirect the output. There is nothing to write by hand and no format to follow.

```
python3 run.py .dogfood.toml > acceptance-report.txt
```

A report looks like this:

```
DOGFOOD 2026 acceptance report
portal: http://localhost:8080
claimed: T1 T2
fixtures: fixtures.json

T1  gallery is public ................. PASS
T1  project from fixtures shown ....... PASS
T1  closed event refuses submissions .. PASS
T2  judge sees own scores ............. PASS
T2  judge cannot see peer scores ...... PASS
T2  participant blocked ............... PASS
T2  csv export works .................. PASS

claimed T1 T2, verified T1 T2
```

Commit it even if it has failures in it. A report with two honest FAIL lines reads better than a README claiming everything works. Write the gaps into your README too, in your own words. Honest reporting is rewarded and there is no advantage in hiding anything, because we run the same checker.

---

## Bonus points

There are four optional challenges on the website: a normalization proof, a pairwise judging mode, a threat model, and an API first design. You may attempt any of them, all of them, or none.

**Bonus points do not change your score.** Your score is the weighted average of the four published criteria, on a scale of 0 to 5, and nothing adds to it.

What bonuses do is break ties. Two projects land on the same number and the one that shipped a documented normalization proof ranks above the one that did not. They also decide the Best Judging Engine prize.

So attempt them because the problems are genuinely interesting, or because you want an edge in a photo finish. Not because you are chasing arithmetic.

---

## What we do not check

Worth saying out loud, because it is most of the document by volume if we listed it as rules.

Your language. Your framework. Your database. Your ORM, or the absence of one. Your schema. Your route names. Your CSS, your component library, your lack of a component library. Your repo layout. Your commit style. Your branch names. Whether you wrote tests and how many. Whether you used Claude Code, Cursor, Copilot or none of them. How you split work between teammates. Whether you sleep.

Pick what you know. A boring stack you are fluent in will get further in 72 hours than an exciting one you are learning.

---

## The five things that are actually required

1. `docker compose up` brings up a working, seeded portal with the network off. No cloud accounts, no hosted database, no external API.
2. An OSI approved license in the repo.
3. Code written during the event window. Frameworks, libraries, boilerplate generators and AI tools are all fine, that is not what this means.
4. `.dogfood.toml` at the repo root, with honest tier claims.
5. `acceptance-report.txt` committed, whatever it says.

Plus the documents the website lists: README, ARCHITECTURE, DATA-MODEL, JUDGING, and the demo video.

---

## If something here is unclear

Ask in Discord. If a question comes up twice, this page gets a line added and everyone sees the same answer. An ambiguity found on Wednesday is a fixed spec. The same ambiguity found on Saturday is three teams building three different things.

Good luck. Build the boring parts well.
