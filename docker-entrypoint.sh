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
  # Invoke the CLI directly by file so it works without a .bin symlink on PATH.
  node node_modules/prisma/build/index.js migrate deploy
  echo "[entrypoint] Migrations up to date."
else
  echo "[entrypoint] RUN_MIGRATIONS=$RUN_MIGRATIONS — skipping migrations."
fi

echo "[entrypoint] Starting: $*"
exec "$@"
