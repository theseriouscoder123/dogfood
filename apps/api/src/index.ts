import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { startWebhookWorker } from "./webhooks/worker";
import { getSigner } from "./records/keys";
import { runReminders, sendNotificationEmails } from "./notifications/notify";

const server = createApp().listen(config.port, () => {
  console.log(`api listening on :${config.port}`);
});
const stopWorker = config.webhookWorker ? startWebhookWorker() : () => {};
// Deadline reminders once a minute; notification emails every few seconds.
const jobs = config.webhookWorker
  ? [
      setInterval(() => void runReminders().catch((err: unknown) => console.error("[reminders]", err)), 60_000),
      setInterval(() => void sendNotificationEmails().catch((err: unknown) => console.error("[notification email]", err)), 5_000),
    ]
  : [];
getSigner().then(
  (s) => console.log(`signing records with Ed25519 key ${s.kid}`),
  (err: unknown) => console.error("signing key unavailable; records can't be issued until this is fixed:", err),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopWorker();
    for (const j of jobs) clearInterval(j);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
