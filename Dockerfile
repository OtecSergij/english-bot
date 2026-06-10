# syntax=docker/dockerfile:1
# Built in GitHub CI, pulled by Coolify (infra/deploy-playbook.md). The bot uses
# long polling — no inbound traffic, no port is exposed; /healthz is localhost-only
# for the HEALTHCHECK below.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# Runtime deps only — dist/ bundles our code but keeps dependencies external
# (see tsup.config.ts for why), so the image ships pruned node_modules.
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:22-slim
# Links the GHCR package to the repo (access control follows the repo).
LABEL org.opencontainers.image.source=https://github.com/OtecSergij/english-bot
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
# `drizzle/` ships the SQL migrations the startup migrator applies (entrypoint).
COPY --chown=node:node docker-entrypoint.sh ./
COPY --chown=node:node drizzle ./drizzle
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
# start-period covers boot + startup migrations before probes count as failures.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.HEALTH_PORT ?? 8080}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["./docker-entrypoint.sh"]
