# syntax=docker/dockerfile:1.7

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /repo

# Enable corepack for pnpm
RUN corepack enable

# Copy workspace manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY artifacts/api-server/package.json ./artifacts/api-server/

# Install all dependencies (dev + prod) for the build
RUN pnpm install --frozen-lockfile --filter @workspace/api-server... --filter @workspace/api-server

# Copy sources
COPY lib/db ./lib/db
COPY lib/api-zod ./lib/api-zod
COPY artifacts/api-server ./artifacts/api-server

# Build the api-server bundle (esbuild → dist/index.mjs)
WORKDIR /repo/artifacts/api-server
RUN node build.mjs

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

# Non-root user
RUN addgroup -S app && adduser -S app -G app

# Copy only the bundled output — it's self-contained
COPY --from=builder /repo/artifacts/api-server/dist ./dist

USER app

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
