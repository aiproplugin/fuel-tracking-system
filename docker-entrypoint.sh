#!/bin/sh
# Runtime entrypoint for the fuel-tracking app image.
#
# Applies any pending Prisma migrations to the target database, then starts the
# process passed as CMD (node server.js). `prisma migrate deploy` is idempotent:
# it only applies migrations that already exist under prisma/migrations and have
# not yet run — it never generates migrations, prompts, resets, or seeds. The
# dev seed (prisma/seed.ts) is intentionally NOT run here.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
  # Run the CLI from its isolated dependency tree (prisma-cli/), pointing at the
  # app's schema. Invoked by file path so it needs no .bin symlink on PATH.
  node prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma
  echo "[entrypoint] Migrations up to date."
else
  echo "[entrypoint] RUN_MIGRATIONS=$RUN_MIGRATIONS — skipping migrations."
fi

echo "[entrypoint] Starting: $*"
exec "$@"
