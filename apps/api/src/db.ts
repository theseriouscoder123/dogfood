import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Either the root client or an interactive-transaction client. */
export type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;
