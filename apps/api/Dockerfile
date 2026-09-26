# Build context is the repo root (see docker-compose.yml) so the shared fixtures can be copied in.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci
COPY apps/api/ ./
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY data/fixtures.json ./data/fixtures.json
COPY apps/api/docker-entrypoint.sh ./
USER node
EXPOSE 4000
CMD ["sh", "docker-entrypoint.sh"]
