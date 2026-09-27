// Every integration run gets its own brand-new database: created here, migrated with
// `prisma migrate deploy` (which never deletes anything), and dropped in teardown.
// Nothing that existed before the run is ever touched, and runs can't interfere.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.DATABASE_URL ?? "postgresql://dogfood:dogfood@localhost:5433/dogfood";
const withDb = (url: string, db: string) => url.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

export default async function setup({ provide }: { provide: (key: string, value: string) => void }) {
  const dbName = `dogfood_test_${Date.now()}_${process.pid}`;
  const admin = new PrismaClient({ datasources: { db: { url: BASE } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();

  const url = withDb(BASE, dbName);
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1" },
  });
  provide("databaseUrl", url);

  return async () => {
    const cleanup = new PrismaClient({ datasources: { db: { url: BASE } } });
    // Only the database this run created, identified by the exact name generated above.
    await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await cleanup.$disconnect();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
