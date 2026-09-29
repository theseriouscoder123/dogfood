#!/usr/bin/env sh
# Puts the public demo back to a fresh install: the database, uploads and caught emails are
# wiped and the seed runs again. The signing key and the HTTPS certificates are kept.
# setup-vm.sh schedules this every 6 hours; run it by hand any time.
set -eu
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.yml -f deploy/docker-compose.demo.yml"

$COMPOSE stop api web gateway hooks mail db
$COMPOSE rm -f api web gateway hooks mail db
docker volume rm dogfood_pgdata dogfood_uploads 2>/dev/null || true
$COMPOSE up -d
echo "demo reset at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
