# syntax=docker/dockerfile:1

# Builder: full install (devDeps for tsc) + production build.
# Native pnpm patches must be present before install.
FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Runner: production-only deps, prebuilt dist, non-root user.
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --prod --frozen-lockfile \
	&& mkdir -p /app/data /app/logs && chown -R node:node /app
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
