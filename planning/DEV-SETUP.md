# Dev setup (for teammates)

## First time
```bash
npm run install:all      # installs apps/api and apps/web
npm run dev:db           # Postgres on localhost:5433, Mailpit on localhost:8025
cd apps/api && npx prisma migrate dev && npm run seed && cd ../..
```
If npm 11+ says install scripts are blocked in `apps/api`, the approvals are already listed in `package.json` (`allowScripts`). Run `npm rebuild` there.

## Every day (two terminals, hot reload)
```bash
npm run dev:api          # http://localhost:4000
npm run dev:web          # http://localhost:3000  (proxies /api to :4000)
```

## Full stack, exactly as the judges run it
```bash
docker compose up --build        # http://localhost:8080
docker compose down -v           # wipe the database and start over
```
Run this after each finished feature, not only at the end.

## Seeded logins (password `dogfood2026` for all)
| Role | Email | Header for curl |
|---|---|---|
| organizer | organizer@dogfood.local | `Cookie: sid=seed-organizer` |
| judge A (jdg_24) | diego.herrera@example.org | `Cookie: sid=seed-judge-a` |
| judge B (jdg_26) | jonas.vogel@example.org | `Cookie: sid=seed-judge-b` |
| participant (team NorthKiln) | priya1@example.org | `Cookie: sid=seed-participant` |
| admin | admin@dogfood.local | `Cookie: sid=seed-admin` |

## Useful
- `npm run db:reset` (in apps/api): drop, migrate and reseed the dev database
- `npm test` (in apps/api): unit tests (policy matrix, CSV, composite scoring)
- `npm run audit:verify` (in apps/api): check the audit log hash chain
- `npx prisma studio` (in apps/api): browse the database

## House rules for the code
- **Permissions:** add a `decide*` function in `apps/api/src/policy.ts` plus a row in `tests/policy.test.ts`. Never compare roles inside a route.
- **Audit:** any write an organizer might care about calls `appendAudit(tx, …)` inside the same transaction.
- **Schema:** change `prisma/schema.prisma`, then run `npx prisma migrate dev --name <what>`. Rules Prisma can't express go into that migration's SQL as hand-written statements.
- **Web:** pages are server components calling `api()` from `src/lib/api.ts`. The web app never talks to the database.
