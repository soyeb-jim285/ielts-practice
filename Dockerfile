# IELTS Practice: API + built web app in one image. The server runs its TypeScript through tsx (no emit step).
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY apps/server apps/server
COPY apps/web apps/web
# Precompressed .gz next to each text asset: serveStatic({ precompressed: true }) sends them without per-request gzip.
RUN pnpm -F @ielts/web build \
 && find apps/web/dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) -exec gzip -k9 {} + \
 && pnpm deploy --legacy --filter @ielts/server --prod /app/apps/server

FROM node:24-alpine
# pg_dump is not needed here (the backup service has its own image); tini reaps children and forwards signals.
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build /app/apps/server apps/server
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY scripts/seed-bank.ts scripts/
COPY data/bank data/bank
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENV NODE_ENV=production PORT=8787 WEB_DIST=/app/apps/web/dist MIGRATIONS_DIR=/app/apps/server/drizzle
WORKDIR /app/apps/server
EXPOSE 8787
USER node
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
