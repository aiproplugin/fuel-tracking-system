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

# ---------- Stage 1: install dependencies (clean, from lockfile) ----------
FROM node:20-bookworm-slim AS deps
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
FROM node:20-bookworm-slim AS builder
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
FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to all interfaces so the container is reachable on the compose network.
ENV HOSTNAME=0.0.0.0

# Run as the unprivileged `node` user that ships with the base image.
# The standalone output already contains the traced node_modules + server.js.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

CMD ["node", "server.js"]
