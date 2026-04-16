FROM node:20-slim AS base
RUN corepack enable pnpm

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/

# Install deps
RUN pnpm install --frozen-lockfile --filter @tilted/server

# Copy server source
COPY apps/server apps/server

# Build
RUN pnpm --filter @tilted/server build

# Production image
FROM node:20-slim AS production
RUN corepack enable pnpm

WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=base /app/apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @tilted/server --prod

COPY --from=base /app/apps/server/dist apps/server/dist
COPY --from=base /app/apps/server/drizzle apps/server/drizzle

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/server/dist/http.js"]
