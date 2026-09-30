#!/bin/sh
# Migrate, (re)seed the generated prompt bank (idempotent upsert by slug), then serve.
set -e
node --import tsx src/db/migrate.ts
node --import tsx ../../scripts/seed-bank.ts
exec node --import tsx src/index.ts
