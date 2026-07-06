# syntax=docker/dockerfile:1
#
# Fuel Usage & Stock Tracking System — production image.
#
# Build-config notes (why this is shaped the way it is):
#  - Tailwind is v3 (see package.json / postcss.config.mjs). This image installs
#    ONLY what package-lock.json pins, so it can never pull in the v4-only
#    `@tailwindcss/postcss` package. That is the fix for the original
#    "Cannot find module '@tailwindcss/postcss'" build failure.
#  - All stages share the SAME base image so the native `argon2` addon and the
#    Prisma query engine compiled/generated at build time match at runtime
#    (no schema binaryTargets change needed).
#  - `next build` imports src/lib/env.ts, which validates DATABASE_URL /
#    NEXTAUTH_SECRET / NEXTAUTH_URL at module load. Real values are injected at
#    RUNTIME by compose; the placeholders below only unblock the build and are
#    never baked into the client bundle (none are NEXT_PUBLIC_*).

# All stages share ONE base image (via this ARG) so the argon2 native addon and
# the Prisma engines compiled/generated in the builder stay ABI-compatible when
# copied into the runner: same glibc, same arch, same Node version (identical
# NODE_MODULE_VERSION / ABI). This is what prevents the "No native build was
# found ... argon2" class of runtime crash.
ARG NODE_IMAGE=node:20-bookworm-slim

# ---------- Stage 1: install dependencies (clean, from lockfile) ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Build toolchain for the argon2 native addon + openssl for Prisma engine.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy only what `npm ci` needs. prisma/ is required because the `postinstall`
# script runs `prisma generate` and needs the schema present.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---------- Stage 2: build the Next.js app ----------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Placeholder env — build-time only, overridden at runtime by compose.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXTAUTH_SECRET="build_time_placeholder_secret_not_used_at_runtime_1234"
ENV NEXTAUTH_URL="http://localhost:3000"

RUN npm run build

# ---------- Stage 3: minimal runtime ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to all interfaces so the container is reachable on the compose network.
ENV HOSTNAME=0.0.0.0
# Auto-apply pending migrations on start; set to "false" to skip (e.g. when a
# separate one-off migration job owns schema changes).
ENV RUN_MIGRATIONS=true

# The standalone output already contains server.js + the traced node_modules.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# --- Native modules Next.js file-tracing does NOT reliably bundle ---
# argon2 resolves its binary at runtime via node-gyp-build from prebuilds/, a
# dynamic path nft cannot follow, so the .node file is missing from standalone
# (the "No native build was found ... argon2" crash). Copy the whole module from
# the builder — same base image => prebuilds/linux-x64/argon2.glibc.node loads.
COPY --from=builder --chown=node:node /app/node_modules/argon2 ./node_modules/argon2

# Prisma's generated client + runtime query engine (libquery_engine-*.so.node),
# and the @prisma/* packages (incl. @prisma/engines for the migration engine).
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma

# --- Prisma CLI + schema + migrations so the entrypoint can migrate on deploy ---
COPY --from=builder --chown=node:node /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=node:node /app/prisma ./prisma

# Entrypoint runs `prisma migrate deploy` (idempotent; never seeds) then execs
# the CMD. sed strips any CR so the shebang works regardless of checkout EOL.
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
