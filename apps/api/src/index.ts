import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { startWebhookWorker } from "./webhooks/worker";

const server = createApp().listen(config.port, () => {
  console.log(`api listening on :${config.port}`);
});
const stopWorker = config.webhookWorker ? startWebhookWorker() : () => {};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopWorker();
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
