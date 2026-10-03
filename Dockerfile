# syntax=docker/dockerfile:1

FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/presentation/package.json ./packages/presentation/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/application/package.json ./packages/application/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY apps/tui/package.json ./apps/tui/package.json
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/presentation ./packages/presentation
COPY packages/core ./packages/core
COPY packages/application ./packages/application
COPY apps/cli ./apps/cli
COPY apps/tui ./apps/tui
RUN pnpm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/presentation/package.json ./packages/presentation/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/application/package.json ./packages/application/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY apps/tui/package.json ./apps/tui/package.json
COPY patches ./patches
RUN pnpm install --prod --frozen-lockfile \
    && mkdir -p /app/data /app/logs && chown -R node:node /app
COPY --from=builder --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder --chown=node:node /app/packages/presentation/dist ./packages/presentation/dist
COPY --from=builder --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=node:node /app/packages/application/dist ./packages/application/dist
COPY --from=builder --chown=node:node /app/apps/cli/dist ./apps/cli/dist
COPY --from=builder --chown=node:node /app/apps/tui/dist ./apps/tui/dist
USER node
CMD ["node", "apps/cli/dist/index.js"]
