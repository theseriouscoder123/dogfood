// npm run audit:verify — recompute the audit log hash chain and report the first broken row.
import { verifyAuditChain } from "../audit";
import { prisma } from "../db";

verifyAuditChain()
  .then((r) => {
    console.log(r.ok ? `audit chain intact (${r.checked} rows)` : `audit chain BROKEN at row ${r.brokenAtId} (after ${r.checked} good rows)`);
    process.exitCode = r.ok ? 0 : 1;
  })
  .finally(() => prisma.$disconnect());
