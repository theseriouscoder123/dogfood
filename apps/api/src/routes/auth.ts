import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../auth/password";
import { clearSessionCookie, createSession, setSessionCookie, tokenFrom } from "../auth/session";
import { audit, fromRequest } from "../audit";
import { HttpError } from "../lib/http";
import { sha256 } from "../lib/crypto";

export const authRouter = Router();

const email = z.email().transform((s) => s.trim().toLowerCase());

const RegisterBody = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

const LoginBody = z.object({ email, password: z.string().min(1).max(200) });

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
