// Runs in each test worker before any test file is imported, so the app's Prisma client
// connects to this run's own database (created in globalSetup).
import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
