// Handles and public profiles.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

export const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const RESERVED_HANDLES = new Set(["admin", "api", "me", "settings", "new", "import", "dogfood", "support", "help", "about", "login", "register"]);

const base = (name: string) => {
  const b = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  return b.length >= 3 && !RESERVED_HANDLES.has(b) ? b : "builder";
};

/** The user's handle, creating one from their name the first time it's needed. */
export async function ensureHandle(user: { id: string; name: string; handle: string | null }, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  if (user.handle) return user.handle;
  const b = base(user.name);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 && b !== "builder" ? b : `${b}-${user.id.replace(/-/g, "").slice(i * 2, i * 2 + 5)}`;
    const taken = await db.user.findUnique({ where: { handle: candidate }, select: { id: true } });
    if (!taken) {
      const r = await db.user.updateMany({ where: { id: user.id, handle: null }, data: { handle: candidate } });
      if (r.count === 1) return candidate;
      return (await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { handle: true } })).handle!;
    }
  }
  throw new Error("could not allocate a handle");
}

/** Link target for a person anywhere in the UI: their handle, or their id until they have one. */
export const profileRef = (u: { id: string; handle: string | null }) => u.handle ?? u.id;
