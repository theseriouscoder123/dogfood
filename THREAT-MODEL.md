# Threat model

What we protect, from whom, how, how we know the defence works, and what is still open. "Evidence" names a test in `apps/api/tests/` or a check anyone can repeat. Where there's no automated test, it says so.

## What we protect

| Asset | Why it matters |
|---|---|
| **The ranking** | The whole point of a judged hackathon. Damage means a wrong winner or a winner nobody trusts |
| **Judge independence** | A judge who can see other scores anchors on them, and the panel stops being independent |
| **The deadline** | Late edits are unfair to everyone who stopped on time |
| **Ballots** | People's Choice is only worth something if one person means one vote |
| **History** | An organizer must not be able to quietly rewrite scores, exclusions or results afterwards |
| **Signed records** | Certificates and judge records are useful only if they can't be forged or altered |
| **Accounts and personal data** | Emails, sessions, API tokens, passwords |
| **The host itself** | The server makes outbound requests (webhooks) and accepts uploads and imports |

## Who might attack

| Actor | Can | Wants |
|---|---|---|
| Visitor | Anonymous HTTP | Private data, accounts, to break things |
| Participant | Signed in, on a team | Edit after the deadline, see or change other teams' drafts, see scores early |
| Judge | Signed in, with assignments | See other judges' scores, judge projects not assigned, influence the result |
| Organizer | Full control of *their own* event | Tilt results quietly, reach other events |
| Vote brigade | Many accounts, inboxes and networks | Stuff People's Choice |
| Webhook target | Receives our requests | Nothing by itself; the risk is an organizer aiming webhooks at *internal* addresses (SSRF) |
| Embedding site | Frames our pages | Clickjacking, reading a visitor's data |
| Someone with database access | Direct SQL | Rewrite anything |

## Defences

### Access control

| Threat | Defence | Evidence |
|---|---|---|
| Hiding a button but serving the data | Every decision is made in the API by `policy.ts`, a pure function of (actor, roles in this event, time window, resource). Pages are server-rendered by calling that same API with the visitor's cookie, so they can't show more than the API allows | `unit/policy.test.ts` (a decision table) |
| A route that forgets its check | **Access matrix.** Every documented route (162 operations, taken from the OpenAPI catalogue) is called as every persona its access level excludes: anonymous, a stranger, a participant, another team's member, the judge, a peer judge, the organizer, another event's organizer, an admin, a read-only token. That's more than 600 calls; each must be refused (401, or 403/404), and the audit log must not grow. A drift test keeps the catalogue identical to the mounted routes, so a new route is covered as soon as it exists | `integration/access-matrix.test.ts`, `unit/openapi.test.ts` |
| A judge reading another judge's work | All judge queries filter on the caller. Another judge's assignment is a 404 (not "forbidden", so it can't be probed), their scores a 403. No endpoint gives judges panel data; head-to-head pairs are chosen without anyone's verdicts | `integration/judge-console.test.ts`, `integration/pairwise.test.ts`, checker T2 #2 |
| An organizer reaching another event | Roles are per event; organizer checks look up roles *in this event* | access matrix ("otherOrganizer") |
| Seeing a draft | Drafts are visible only to the team and to staff; to anyone else they are 404 | `integration/core.test.ts` |
| Organizers voting or scoring on someone's behalf | Scoring and comparisons require the judge role *and* the assignment. Organizers get 403 | `integration/pairwise.test.ts`, access matrix |

### The deadline

| Threat | Defence | Evidence |
|---|---|---|
| Editing, submitting, unsubmitting or withdrawing after the deadline | Checked in the API against the **server's** clock, never the browser's. Every late attempt is refused and written to the audit log (`submission.refused_closed`) | `integration/core.test.ts`, checker T1 #3 |
| Squeezing into a full team | Joining locks the team's row, then re-checks the size | `integration/core.test.ts` |

### Results and history

| Threat | Defence | Evidence |
|---|---|---|
| Publishing a ranking before judging ends | Results can be published only after judging closes. Before that, the public results endpoint is 404 even if you know the URL | `integration/results.test.ts` |
| Quietly editing a result | Result runs are **immutable**: database triggers refuse UPDATE and DELETE. A run carries a SHA-256 fingerprint of all its inputs; a run that no longer matches the data is *stale* and can't be published | `integration/results.test.ts` |
| Dropping an inconvenient judge | Excluding a judge needs a written reason, stored in the run and the audit log | `integration/results.test.ts` |
| Rewriting what happened | The audit log is **hash-chained** (`hash = sha256(prevHash + row)`), and triggers refuse UPDATE, DELETE and TRUNCATE. `npm run audit:verify` re-hashes everything | `integration/*` (several tests verify the chain), `npm run audit:verify` |
| Changing a score after the fact | A revised review is audited with before and after values. The rubric's structure freezes once scoring starts. The database checks every score against its criterion's range | `integration/judge-console.test.ts`, `integration/judging-setup.test.ts` |

### Signed records

| Threat | Defence | Evidence |
|---|---|---|
| Forged or altered certificates | Ed25519 signatures over canonical JSON. Verifiable in the browser (`/verify/<id>`) or offline (`node tools/verify-record.mjs`) without trusting our UI | `integration/records.test.ts` ("revoking and tamper-resistance"), `unit/records.test.ts` |
| Quietly reissuing or deleting a record | Records are append-only (trigger). A correction supersedes the old record; a revocation is permanent, public and carries a reason | `integration/records.test.ts` |
| The signing key leaking | The key is a file with mode 0600 on its own volume, never in the database. Public keys are kept by key id, so after rotation old records still verify under their old key | `apps/api/src/records/keys.ts` |

### Community voting

| Threat | Defence | Evidence |
|---|---|---|
| One person, many votes | Verified email (one inbox, one vote: `+tags` and Gmail dots are folded), accounts, or single-use ballot codes. Throwaway-inbox domains are refused | `integration/voting.test.ts`, `unit/voting.test.ts` |
| Flooding | Per network: 60 new ballots and 20 wrong ballot codes an hour. Each ballot: 30 changes an hour. Sign-in links: per network and per inbox | `integration/vote-abuse.test.ts` |
| Coordinated stuffing | Six signals are combined into incidents: a shared network, identical ballots, fresh accounts, patterned addresses, surges, and voting without opening the projects. Organizers review incidents and quarantine ballots with a reason (audited and reversible). Voters' emails are masked in the review queue | `integration/vote-abuse.test.ts` (a planted ring is found as one high-severity incident) |
| Position bias | Each voter sees their own random order; the results include a chi-square test for position effects | `unit/voting.test.ts`, `unit/tally.test.ts` |
| Peeking at the count, or tweaking it | Counts are sealed while voting is open, even from organizers and exports. Publishing fixes a fingerprint of the anonymous ballot file, which anyone can download and recount; voters can confirm their ballot was counted | `integration/voting-results.test.ts` |

### Accounts

| Threat | Defence | Evidence |
|---|---|---|
| Password guessing | scrypt (N = 16384, r = 8, p = 1), constant-time compare. **At most 10 failed sign-ins per account and 50 per network in 15 minutes**, then 429 with `Retry-After`. The right password also waits, so guessing can't just continue | `integration/auth-hardening.test.ts` |
| Taking over an invited judge's account by registering with their email | Invited and imported people have no password until they set one through a link sent to their inbox. Registering with such an address signs nobody in; it emails the owner a link | `integration/auth-hardening.test.ts` |
| Finding out who has an account | Login and "forgot password" answer the same way whether the account exists or not | `apps/api/src/routes/auth.ts` (see Residual risks: register) |
| Stolen session or token at rest | Only SHA-256 hashes of session tokens, API tokens, invite links, reset links and ballot codes are stored | `integration/api-tokens.test.ts` ("stores only its hash") |
| A leaked API token | Scopes (read, or read+write), expiry, revocation, 600 requests a minute per token. Some actions refuse tokens outright (voting, commenting, token management, changing the password) | `integration/api-tokens.test.ts`, access matrix ("readToken") |
| Stolen session | `httpOnly` cookie; `Secure` with `COOKIE_SECURE=true`. "Sign out everywhere else" is available, and a password change signs out other sessions | `integration/profiles.test.ts` |

### The browser

| Threat | Defence | Evidence |
|---|---|---|
| Cross-site request forgery | Session cookies are `SameSite=Lax`, so browsers don't send them on cross-site POST, PUT or DELETE. Bodies are JSON | Browser behaviour; see Residual risks |
| Script injection (XSS) | React escapes output. Markdown is rendered by `react-markdown` **without raw HTML**, and link URLs are limited to http(s) and mailto. The raw-HTML points are only the theme boot script (constant), the embed theme (`light` or `dark` only) and the certificate QR code (SVG generated by the server from the verify URL) | `apps/web/src/components/Markdown.tsx` |
| Hostile uploads | Images only (PNG, JPEG, GIF, WebP), recognised by their **first bytes**, not their name or declared type. SVG isn't accepted. 5 MB each. Served with `X-Content-Type-Options: nosniff` and stored by content hash | `apps/api/src/routes/uploads.ts` (no dedicated test) |
| Clickjacking | Every page sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`, except `/embed/*`, which exists to be framed | Checked by hand with `curl -I` (no automated test) |
| An embed leaking the viewer's data | The embed fetches data anonymously, and the layout renders it without a session lookup, so its HTML is the same for everyone | Checked by hand: the page text is the same for a signed-in organizer and a visitor (no automated test) |

### Outbound requests (webhooks)

| Threat | Defence | Evidence |
|---|---|---|
| SSRF: an organizer aims a webhook at the database, a metadata service or the LAN | URLs must be http(s), with no credentials. Loopback, private, link-local, CGNAT, benchmark, multicast and IPv6 local ranges are refused when the URL is saved, **and again at send time after DNS resolution**. Redirects aren't followed; requests time out. `WEBHOOK_ALLOW_PRIVATE_HOSTS` exempts named internal receivers | `unit/webhooks.test.ts` ("address guard"), `integration/webhooks.test.ts` |
| Forged webhook calls to receivers | Standard Webhooks signatures (HMAC-SHA256 over id, timestamp and body). Rotation keeps the old secret valid for 24 h | `unit/webhooks.test.ts` |
| Data leaking through webhooks | Payloads are thin: ids, a few public fields and API links. Never scores, emails or ballots | `apps/api/src/webhooks/catalog.ts` |
| A dead endpoint hammered forever | Retries back off over about 45 h. After 5+ failures lasting 24 h, or a `410 Gone`, the endpoint is switched off and organizers are told | `unit/webhooks.test.ts`, `integration/webhooks.test.ts` |

### The host

| Threat | Defence |
|---|---|
| Oversized requests | JSON bodies ≤ 1 MB, event import ≤ 25 MB (gateway 26 MB), uploads ≤ 5 MB |
| Container escape impact | API and web run as the unprivileged `node` user. The database, Mailpit and the webhook receiver publish only on `127.0.0.1` |
| A forged client address defeating per-network limits | Only the gateway's `X-Forwarded-For` hop is believed (`TRUST_PROXY=1`), so anything a client adds is ignored (`integration/auth-hardening.test.ts`) |
| Supply chain | Exact dependency versions, installed with `npm ci` from the lockfile. No runtime downloads: the portal runs with the network off (`tools/offline-check.compose.yml`) |

## Found while writing this

Verifying every row above against the running system turned up four real problems, fixed before submission:

1. **Forgeable client address.** The API trusted every `X-Forwarded-For` entry, so a client could claim any IP. That defeats the per-network vote limits and the "shared network" signal. We sent `X-Forwarded-For: 6.6.6.6` through the gateway and the audit log recorded 6.6.6.6. Now only one proxy hop is trusted: the same request records the real address.
2. **No limit on password guessing.** Fixed as described under Accounts.
3. **Account takeover of invited judges.** Registering with the email of an invited, password-less judge used to set the password and sign in, so knowing a judge's address was enough to become them. Now it only emails the owner.
4. **The embed contained the viewer's name.** The site header was hidden with CSS but still rendered with the signed-in user. The embed is now rendered without it.

Each has a regression test, listed above.

## Residual risks

We know about these and don't fully defend against them.

- **Same-site CSRF.** `SameSite=Lax` stops cross-*site* requests, not requests from a sibling subdomain of the same registrable domain. If you host at `hack.example.org`, don't let untrusted people run pages on `*.example.org`. There's no Origin-header check or CSRF token.
- **DNS rebinding.** The webhook guard resolves the name and then connects. A hostile DNS server could answer differently between the two, which a pinned-address connection would close. Mitigation: run the API where it can't reach anything sensitive, or keep `WEBHOOK_ALLOW_PRIVATE_HOSTS` empty and firewall outbound traffic.
- **Webhook secrets are stored in the database as-is.** They have to be, to sign. Anyone who can read the database can forge webhook calls to your receivers. Rotate them after a database compromise.
- **Someone with database superuser access** can drop the triggers, rewrite rows and recompute the whole hash chain. The chain proves *consistency*, not that it was never recomputed, because we don't anchor its head anywhere external. Signed records are the exception: they can't be forged without the key file.
- **Whoever holds the signing key can sign anything.** Protect the `keys` volume.
- **Registration reveals whether an email has an account** (`409 email_taken`). We accepted this for clearer sign-up; login and password reset don't reveal it.
- **A determined vote brigade** with many real inboxes on many unrelated networks, which opens projects before voting, looks like real fans. The detectors raise the cost; they can't make it impossible.
- **Limits live in memory, per process.** Sign-in and token limits reset on restart and aren't shared between API replicas. Several replicas are untested anyway.
- **No two-factor sign-in, no SSO.**
- **No general request rate limit for anonymous reads,** and no full Content-Security-Policy on pages (only `frame-ancestors`). Put the portal behind a proxy or CDN with rate limiting for a large public event.
- **Judges' leniency correction assumes good faith.** A judge who deliberately scores one project high and its rivals low within a normal-looking range can shift results. Integrity flags (outliers, disagreement with the panel, head-to-head agreement) make this visible, not impossible.

## Operator checklist

Before a real event:

- [ ] `SEED_FIXTURES=false` and `SEED_DEMO=false` (removes the demo sessions, the demo token and the demo webhooks).
- [ ] `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD`.
- [ ] Serve over HTTPS behind a TLS proxy, and set `COOKIE_SECURE=true` and `PUBLIC_BASE_URL`. If you add a proxy in front of the gateway, raise `TRUST_PROXY` by one.
- [ ] Change the Postgres password in `docker-compose.yml`, and keep port 5433 on localhost.
- [ ] Delete the `hooks` demo service, and leave `WEBHOOK_ALLOW_PRIVATE_HOSTS` empty.
- [ ] Real SMTP (`SMTP_URL`, `MAIL_FROM`).
- [ ] Back up `pgdata`, `uploads` and `keys`, and keep the `keys` backup separate and access-controlled.
- [ ] Consider `HOSTING=admins` if you don't want any signed-in user creating draft events.
