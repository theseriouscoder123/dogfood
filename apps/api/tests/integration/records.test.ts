// T4 phase 3: signed judge participation records and participant certificates.
import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";
import { canonicalJson } from "../../src/lib/crypto";
import { reviewsDigest } from "../../src/records/issue";
import { getSigner, resetSignerForTests, verifyText } from "../../src/records/keys";
import { config } from "../../src/config";

const run = promisify(execFile);
const TOOL = path.resolve(__dirname, "../../../../tools/verify-record.mjs");

afterAll(async () => {
  await prisma.$disconnect();
});

/** Judging closed: two judges with submitted reviews, one with none; two teams with submitted projects. */
async function setup() {
  const ctx = await makeEvent({ open: false });
  await prisma.event.update({ where: { id: ctx.event.id }, data: { judgingOpensAt: new Date(Date.now() - 2 * 3_600_000), judgingClosesAt: new Date(Date.now() - 60_000) } });
  const quality = await prisma.criterion.create({ data: { eventId: ctx.event.id, key: "quality", label: "Quality", weight: 1, minScore: 1, maxScore: 5, position: 0 } });
  const a = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Aurora");
  const b = await makeTeamWithProject(ctx.event.id, ctx.trackB.id, "Beacon");
  const j1 = await makeJudge(ctx.event.id, [ctx.trackA.id]);
  const j2 = await makeJudge(ctx.event.id);
  const idle = await makeJudge(ctx.event.id);
  const r1 = await makeReview(ctx.event.id, j1.id, a.project.id, { [quality.id]: 4 });
  const r2 = await makeReview(ctx.event.id, j1.id, b.project.id, { [quality.id]: 2 });
  await makeReview(ctx.event.id, j2.id, a.project.id, { [quality.id]: 5 });
  return { ...ctx, o: ctx.organizer.cookie, a, b, j1, j2, idle, reviews: [r1.review!, r2.review!] };
}

const issue = (base: string, cookie: string) => api().post(`${base}/records/issue`).set("Cookie", cookie);
const recordFor = (eventId: string, userId: string) => prisma.signedRecord.findFirstOrThrow({ where: { eventId, userId, supersededById: null } });

describe("issuing", () => {
  it("waits until judging has closed", async () => {
    const ctx = await makeEvent();
    const r = await issue(ctx.base, ctx.organizer.cookie);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("judging_not_closed");
  });

  it("is for organizers only", async () => {
    const s = await setup();
    expect((await issue(s.base, s.j1.cookie)).status).toBe(403);
    expect((await issue(s.base, s.a.member.cookie)).status).toBe(403);
    expect((await api().get(`${s.base}/records`).set("Cookie", s.j1.cookie)).status).toBe(403);
  });

  it("signs a record for every judge with a submitted review and every member of a submitted project", async () => {
    const s = await setup();
    const r = await issue(s.base, s.o);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ issued: 4, superseded: 0, unchanged: 0 }); // 2 judges + 2 participants; the idle judge gets nothing
    expect(await prisma.signedRecord.count({ where: { eventId: s.event.id, userId: s.idle.id } })).toBe(0);

    const list = await api().get(`${s.base}/records`).set("Cookie", s.o);
    expect(list.body.issuable).toBe(true);
    expect(list.body.records.map((x: { type: string }) => x.type).sort()).toEqual(["judge_participation", "judge_participation", "participation", "participation"]);
  });

  it("commits to a judge's exact reviews without revealing a score", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    const rec = await recordFor(s.event.id, s.j1.id);
    const st = rec.statement as { claims: Record<string, unknown>; subject: { name: string; role: string } };
    expect(st.subject).toEqual({ name: s.j1.name, role: "judge" });
    expect(st.claims).toMatchObject({ reviewsSubmitted: 2, projectsReviewed: 2, tracks: ["Track A"] });
    const expected = reviewsDigest(s.reviews.map((r, i) => ({ id: r.id, projectId: r.projectId, submittedAt: r.submittedAt, scores: { quality: [4, 2][i]! } })));
    expect(st.claims.reviewsDigest).toBe(expected);
    expect(JSON.stringify(rec.statement)).not.toMatch(/"quality"|"scores"/);
    expect(JSON.stringify(rec.statement)).not.toContain(s.j1.email);
  });

  it("re-signs only when the facts change, and supersedes the old record", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    expect((await issue(s.base, s.o)).body).toEqual({ issued: 0, superseded: 0, unchanged: 4 });

    const before = await recordFor(s.event.id, s.a.member.id);
    await prisma.team.update({ where: { id: s.a.team.id }, data: { name: "Aurora Collective" } });
    expect((await issue(s.base, s.o)).body).toEqual({ issued: 1, superseded: 1, unchanged: 3 });
    const after = await recordFor(s.event.id, s.a.member.id);
    expect(after.id).not.toBe(before.id);
    expect((after.statement as { claims: { team: string } }).claims.team).toBe("Aurora Collective");

    const old = await api().get(`/api/records/${before.id}`);
    expect(old.body).toMatchObject({ status: "superseded", signatureValid: true, supersededById: after.id });
  });

  it("includes the placement once results are published", async () => {
    const s = await setup();
    const run = await prisma.normalizationRun.create({
      data: { eventId: s.event.id, method: "additive-ridge-v1", params: {}, weights: { quality: 1 }, componentCount: 1, inputHash: "x".repeat(64), results: { create: [{ projectId: s.a.project.id, nReviews: 2, rank: 1 }, { projectId: s.b.project.id, nReviews: 1, rank: 2 }] } },
    });
    await prisma.event.update({ where: { id: s.event.id }, data: { publishedRunId: run.id } });
    await issue(s.base, s.o);
    const st = (await recordFor(s.event.id, s.b.member.id)).statement as { claims: { placement: unknown; project: { title: string } } };
    expect(st.claims.project.title).toBe("Beacon");
    expect(st.claims.placement).toEqual({ rank: 2, of: 2, runId: run.id, method: "additive-ridge-v1" });
  });
});

describe("verifying", () => {
  it("is public, and hands out the exact signed text", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    const rec = await recordFor(s.event.id, s.j1.id);
    const r = await api().get(`/api/records/${rec.id}`); // anonymous
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "current", signatureValid: true, signature: rec.signature, key: { kid: rec.kid, alg: "Ed25519" } });
    expect(r.body.signedText).toBe(canonicalJson(rec.statement));
    expect(verifyText(r.body.key.publicKeyPem, r.body.signedText, r.body.signature)).toBe(true);
    expect(verifyText(r.body.key.publicKeyPem, r.body.signedText.replace(s.j1.name, "Someone Else"), r.body.signature)).toBe(false);
    expect((await api().get("/api/records/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("passes the standalone verifier, which catches any edit", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    const rec = await recordFor(s.event.id, s.a.member.id);
    const dir = await mkdtemp(path.join(tmpdir(), "dogfood-verify-"));
    try {
      const file = path.join(dir, "record.json");
      await writeFile(file, JSON.stringify((await api().get(`/api/records/${rec.id}/signed.json`)).body));
      const keys = (await api().get("/api/records/keys")).body.keys as Array<{ kid: string; publicKeyPem: string }>;
      await writeFile(path.join(dir, "key.pem"), keys.find((k) => k.kid === rec.kid)!.publicKeyPem);

      const ok = await run(process.execPath, [TOOL, file, "--key", path.join(dir, "key.pem")]);
      expect(ok.stdout).toContain("✓ signature valid");

      const forged = JSON.parse(await readFile(file, "utf8"));
      forged.statement.claims.placement = { rank: 1, of: 2, runId: "made-up", method: "wishful" };
      await writeFile(file, JSON.stringify(forged));
      const bad = await run(process.execPath, [TOOL, file, "--key", path.join(dir, "key.pem")]).catch((e: { code: number; stdout: string }) => e);
      expect(bad.code).toBe(1);
      expect(bad.stdout).toContain("✗ signature INVALID");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists your own records", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    const mine = await api().get("/api/records/mine").set("Cookie", s.j2.cookie);
    expect(mine.body.records).toHaveLength(1);
    expect(mine.body.records[0]).toMatchObject({ type: "judge_participation", status: "current", event: { slug: s.event.slug } });
    expect((await api().get("/api/records/mine")).status).toBe(401);
  });
});

describe("revoking and tamper-resistance", () => {
  it("revokes with a reason, once, and doesn't quietly re-issue", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    const rec = await recordFor(s.event.id, s.j2.id);
    expect((await api().post(`${s.base}/records/${rec.id}/revoke`).set("Cookie", s.o).send({ reason: "no" })).status).toBe(400);
    expect((await api().post(`${s.base}/records/${rec.id}/revoke`).set("Cookie", s.o).send({ reason: "Judge withdrew; reviews reassigned." })).status).toBe(200);
    expect((await api().post(`${s.base}/records/${rec.id}/revoke`).set("Cookie", s.o).send({ reason: "Twice for good measure" })).status).toBe(409);
    const pub = await api().get(`/api/records/${rec.id}`);
    expect(pub.body).toMatchObject({ status: "revoked", signatureValid: true, revokedReason: "Judge withdrew; reviews reassigned." });
    expect((await issue(s.base, s.o)).body).toEqual({ issued: 0, superseded: 0, unchanged: 3 });
    expect(await prisma.auditLog.count({ where: { action: "record.revoked", entityId: rec.id } })).toBe(1);
  });

  it("refuses to change a signed statement, un-revoke, or delete, even with direct database access", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    const rec = await recordFor(s.event.id, s.a.member.id);
    await expect(prisma.$executeRaw`UPDATE "SignedRecord" SET statement = '{"forged":true}'::jsonb WHERE id = ${rec.id}::uuid`).rejects.toThrow(/cannot change/);
    await expect(prisma.$executeRaw`DELETE FROM "SignedRecord" WHERE id = ${rec.id}::uuid`).rejects.toThrow(/cannot be deleted/);
    await prisma.signedRecord.update({ where: { id: rec.id }, data: { revokedAt: new Date(), revokedReason: "test" } });
    await expect(prisma.signedRecord.update({ where: { id: rec.id }, data: { revokedAt: null } })).rejects.toThrow(/cannot be undone/);
  });

  it("lets records go with their person when an account is deleted (cascade), but never on their own", async () => {
    const ctx = await makeEvent();
    const u = await makeUser();
    const signer = await getSigner();
    const rec = await prisma.signedRecord.create({ data: { eventId: ctx.event.id, userId: u.id, type: "participation", statement: { test: true }, signature: "x", kid: signer.kid } });
    await expect(prisma.signedRecord.delete({ where: { id: rec.id } })).rejects.toThrow(/cannot be deleted/);
    await prisma.session.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.signedRecord.count({ where: { id: rec.id } })).toBe(0);
  });

  it("keeps old records verifiable after the signing key is rotated", async () => {
    const s = await setup();
    await issue(s.base, s.o);
    const old = await recordFor(s.event.id, s.j1.id);
    const oldKid = (await getSigner()).kid;

    await rm(config.signingKeyPath, { force: true });
    resetSignerForTests();
    const fresh = await getSigner();
    expect(fresh.kid).not.toBe(oldKid);

    const keys = (await api().get("/api/records/keys")).body.keys as Array<{ kid: string; retiredAt: string | null }>;
    expect(keys.find((k) => k.kid === oldKid)?.retiredAt).not.toBeNull();
    expect(keys.find((k) => k.kid === fresh.kid)?.retiredAt).toBeNull();
    expect((await api().get(`/api/records/${old.id}`)).body).toMatchObject({ status: "current", signatureValid: true, key: { kid: oldKid } });

    const other = await setup();
    await issue(other.base, other.o);
    expect((await recordFor(other.event.id, other.j1.id)).kid).toBe(fresh.kid);
  });

  it("leaves the audit chain intact", async () => {
    const u = await makeUser();
    expect(u.id).toBeTruthy();
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});
