import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { startWebhookWorker } from "./webhooks/worker";
import { getSigner } from "./records/keys";

const server = createApp().listen(config.port, () => {
  console.log(`api listening on :${config.port}`);
});
const stopWorker = config.webhookWorker ? startWebhookWorker() : () => {};
getSigner().then(
  (s) => console.log(`signing records with Ed25519 key ${s.kid}`),
  (err: unknown) => console.error("signing key unavailable; records can't be issued until this is fixed:", err),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopWorker();
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
