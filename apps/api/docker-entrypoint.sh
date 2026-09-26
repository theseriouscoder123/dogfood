#!/bin/sh
# Migrate, seed (idempotent), then serve. Runs on every container start.
# Call binaries directly (not npx) so nothing tries to reach the npm registry offline.
set -e
./node_modules/.bin/prisma migrate deploy
node dist/seed/run.js
exec node dist/index.js
