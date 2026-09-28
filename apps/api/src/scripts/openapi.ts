// npm run openapi: writes docs/openapi.json, the same document the API serves at /api/openapi.json.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSpec } from "../openapi/spec";

const out = path.resolve(process.cwd(), "../../docs/openapi.json");
const server = process.env.PUBLIC_BASE_URL ?? "http://localhost:8080";

writeFile(out, `${JSON.stringify(buildSpec(server), null, 2)}\n`).then(
  () => {
    console.log(`wrote ${path.relative(process.cwd(), out)}`);
    process.exit(0);
  },
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
