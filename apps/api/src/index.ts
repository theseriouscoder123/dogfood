import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";

const server = createApp().listen(config.port, () => {
  console.log(`api listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
