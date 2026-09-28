import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../auth/password";
import { clearSessionCookie, createSession, setSessionCookie, tokenFrom } from "../auth/session";
import { audit, fromRequest } from "../audit";
import { HttpError } from "../lib/http";
import { randomToken, sha256 } from "../lib/crypto";
import { absoluteUrl, sendMail } from "../lib/mail";
import { isDisposableEmail } from "../voting/disposable";

export const authRouter = Router();

const email = z.email().transform((s) => s.trim().toLowerCase());

export const RegisterBody = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

export const LoginBody = z.object({ email, password: z.string().min(1).max(200) });

authRouter.post("/register", async (req, res) => {
  const body = RegisterBody.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing?.passwordHash) throw new HttpError(409, "email_taken", "An account with this email already exists.");

  // Imported people (judges, fixture team members) exist without a password; registering claims the account.
  const passwordHash = await hashPassword(body.password);
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name: body.name } })
    : await prisma.user.create({ data: { email: body.email, name: body.name, passwordHash } });

  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  await audit({
    ...fromRequest(req),
    actor: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
    action: existing ? "user.claim" : "user.register",
    entityType: "User",
    entityId: user.id,
  });
  res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } });
});

authRouter.post("/login", async (req, res) => {
  const body = LoginBody.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  // Same error whether the email exists or not, so logins can't be used to enumerate accounts.
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
  }
  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } });
});

authRouter.post("/logout", async (req, res) => {
  const token = tokenFrom(req.cookies, req.headers.authorization);
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token), seeded: false } });
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", async (req, res) => {
  if (!req.actor) {
    res.json({ user: null, roles: [] });
    return;
  }
  const roles = await prisma.eventRole.findMany({
    where: { userId: req.actor.id },
    select: { role: true, event: { select: { slug: true, name: true } } },
  });
  res.json({ user: req.actor, roles: roles.map((r) => ({ role: r.role, event: r.event })) });
});

// ── password reset ──────────────────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000;

/** Always answers the same way, so it can't be used to discover which emails have accounts. */
export const ForgotBody = z.object({ email });

authRouter.post("/forgot", async (req, res) => {
  const body = ForgotBody.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user) {
    const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_TTL_MS) } } });
    if (recent < 5) {
      const token = randomToken();
      await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
      await sendMail({
        to: user.email,
        subject: "Reset your Dogfood password",
        heading: `Hi ${user.name}, reset your password`,
        body: [
          user.passwordHash
            ? "Someone (hopefully you) asked to reset the password for this account. The link works once and expires in an hour."
            : "Use this link to set a password and activate your account. The link works once and expires in an hour.",
          "If you didn't ask for this, you can ignore this email.",
        ],
        action: { label: user.passwordHash ? "Reset password" : "Set password", url: absoluteUrl(`/reset/${token}`) },
      });
      await audit({ ...fromRequest(req), actorLabel: "anonymous", action: "auth.reset_requested", entityType: "User", entityId: user.id });
    }
  }
  res.json({ ok: true });
});

export const ResetBody = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200) });

authRouter.post("/reset", async (req, res) => {
  const body = ResetBody.parse(req.body);
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(body.token) }, include: { user: true } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) {
    throw new HttpError(400, "invalid_reset", "This reset link is invalid or has expired. Ask for a new one.");
  }
  const passwordHash = await hashPassword(body.password);
  await prisma.$transaction([
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    // Following a link from the inbox proves the address, so a reset also verifies it.
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash, emailVerifiedAt: reset.user.emailVerifiedAt ?? new Date() } }),
    // A reset signs out every other device.
    prisma.session.deleteMany({ where: { userId: reset.userId, seeded: false } }),
  ]);
  const { token, expiresAt } = await createSession(reset.userId);
  setSessionCookie(res, token, expiresAt);
  const u = reset.user;
  await audit({ ...fromRequest(req), actor: { id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin }, action: "auth.password_reset", entityType: "User", entityId: u.id });
  res.json({ user: { id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin } });
});

// ── one-time sign-in links ──────────────────────────────────────────────────
// "Email me a link": proves the inbox, signs the person in, and creates a password-less account
// if there isn't one. This is what verified-email community voting is built on.

const LINK_TTL_MS = 30 * 60 * 1000;
const LINKS_PER_EMAIL_PER_HOUR = 5;
const LINKS_PER_IP_PER_HOUR = 20;

/** Only same-site paths, so a link can never be turned into an open redirect. */
const safeNext = (next: string | undefined) => (next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : "/");

export const LinkBody = z.object({ email, next: z.string().max(300).optional() });

authRouter.post("/link", async (req, res) => {
  const body = LinkBody.parse(req.body);
  const hourAgo = new Date(Date.now() - 3_600_000);
  const ip = req.ip ?? null;
  if (ip && (await prisma.loginLink.count({ where: { ip, createdAt: { gt: hourAgo } } })) >= LINKS_PER_IP_PER_HOUR)
    throw new HttpError(429, "too_many_links", "Too many sign-in links from this network. Try again in an hour.");

  const next = safeNext(body.next);
  if (/^\/events\/[\w-]+\/vote/.test(next) && isDisposableEmail(body.email))
    throw new HttpError(400, "disposable_email", "Throwaway email addresses can't vote. Use an address you keep.");
  // Past the per-inbox limit we quietly send nothing: same answer either way.
  if ((await prisma.loginLink.count({ where: { email: body.email, createdAt: { gt: hourAgo } } })) < LINKS_PER_EMAIL_PER_HOUR) {
    const token = randomToken();
    await prisma.loginLink.create({ data: { email: body.email, tokenHash: sha256(token), next, ip, expiresAt: new Date(Date.now() + LINK_TTL_MS) } });
    const slug = next.match(/^\/events\/([\w-]+)\/vote/)?.[1];
    const event = slug ? await prisma.event.findUnique({ where: { slug }, select: { name: true } }) : null;
    await sendMail({
      to: body.email,
      subject: event ? `Your voting link for ${event.name}` : "Your Dogfood sign-in link",
      heading: event ? `Vote in ${event.name}` : "Sign in to Dogfood",
      body: [
        event ? "Use this link to confirm your email and open your ballot." : "Use this link to sign in.",
        "It works once and expires in 30 minutes. If you didn't ask for it, ignore this email.",
      ],
      action: { label: event ? "Open my ballot" : "Sign in", url: absoluteUrl(`/signin/${token}`) },
    });
  }
  res.json({ ok: true });
});

export const LinkVerifyBody = z.object({ token: z.string().min(10).max(200) });

authRouter.post("/link/verify", async (req, res) => {
  const body = LinkVerifyBody.parse(req.body);
  const link = await prisma.loginLink.findUnique({ where: { tokenHash: sha256(body.token) } });
  if (!link || link.usedAt || link.expiresAt <= new Date()) throw new HttpError(400, "invalid_link", "This sign-in link is invalid, used or expired. Ask for a new one.");

  const user = await prisma.$transaction(async (tx) => {
    const used = await tx.loginLink.updateMany({ where: { id: link.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count === 0) throw new HttpError(400, "invalid_link", "This sign-in link has already been used.");
    const existing = await tx.user.findUnique({ where: { email: link.email } });
    if (existing) return tx.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } });
    const local = link.email.split("@")[0]!.replace(/[._+-]+/g, " ").trim();
    const name = local ? local.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) : "Voter";
    return tx.user.create({ data: { email: link.email, name, emailVerifiedAt: new Date() } });
  });
  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  await audit({ ...fromRequest(req), actor: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin }, action: "auth.link_signin", entityType: "User", entityId: user.id });
  res.json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin }, next: link.next });
});
